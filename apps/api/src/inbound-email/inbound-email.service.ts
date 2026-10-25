import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { simpleParser, type ParsedMail } from 'mailparser';
import { AttachmentsService, type IncomingFile } from '../attachments/attachments.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { mailboxAddress } from '../notifications/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isAgent } from '../tickets/ticket-scope.js';
import { TicketsService, type EmailAuthor, type EmailWrite } from '../tickets/tickets.service.js';
import { UsersService } from '../users/users.service.js';
import { emailBody } from './email-content.js';
import { headerDiscardReason, type DiscardReason } from './loop-guard.js';
import {
  MAILBOX_SOURCE,
  type CursorStore,
  type MailboxSource,
  type RawEmail,
} from './mailbox-source.js';

export type InboundOutcome = 'processed' | 'discarded' | 'failed' | 'duplicate';

export interface PollResult {
  processed: number;
  discarded: number;
  failed: number;
  duplicates: number;
}

/** Erro de regra (o e-mail vira `failed` e o cursor segue), diferente de falha de infraestrutura. */
class InboundRejection extends Error {}

/** O que vai em toda linha de `inbound_emails`. */
interface InboundRow {
  messageId: string;
  imapUid: bigint;
  fromEmail: string;
  subject: string | null;
  rawStorageKey: string | null;
  receivedAt: Date;
}

const CURSOR_UID = 'mailbox.last_uid';
const CURSOR_VALIDITY = 'mailbox.uid_validity';
const DEFAULT_CATEGORY = 'Geral';
const SUBJECT_MAX = 200;
const HOUR_MS = 60 * 60_000;
const TAG = /\[#(\d{1,9})\]/;

const MESSAGE_IDS = /<[^<>\s]+>/g;

/** `Message-ID`s de `In-Reply-To` e `References`, do mais próximo para o mais distante (RN-11). */
export function referencedIds(parsed: Pick<ParsedMail, 'inReplyTo' | 'references'>): string[] {
  const refs = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  const fromReferences = refs.flatMap((value) => value.match(MESSAGE_IDS) ?? []).toReversed();
  const fromReplyTo = parsed.inReplyTo?.match(MESSAGE_IDS) ?? [];
  return [...new Set([...fromReplyTo, ...fromReferences])];
}

/** RN-14: assunto sem as tags `[#n]`, sem espaços extras, até 200 caracteres. */
export function ticketSubject(subject: string | undefined): string {
  const clean = (subject ?? '')
    .replace(/\[#\d+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean === '' ? '(sem assunto)' : clean.slice(0, SUBJECT_MAX);
}

const IMAGE_EXTENSIONS: Record<string, string> = { jpeg: 'jpg', pjpeg: 'jpg', 'x-png': 'png' };

/** Nome do anexo; imagens coladas (inline) costumam vir sem nome. */
function attachmentName(filename: string | undefined, contentType: string, index: number) {
  if (filename) return filename;
  const [type, subtype = 'bin'] = contentType.split('/');
  const extension = IMAGE_EXTENSIONS[subtype] ?? subtype;
  return `${type === 'image' ? 'imagem' : 'anexo'}-${index + 1}.${extension}`;
}

/**
 * E-mail de entrada (spec T21): lê a caixa pelo `MailboxSource`, decide o destino de cada e-mail
 * e grava pelos services de tickets. Nunca loga corpo, anexos nem o endereço do remetente.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);
  private readonly ownAddress: string;
  private readonly internalDomains: readonly string[];
  private readonly rateLimit: number;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly categories: CategoriesService,
    private readonly tickets: TicketsService,
    private readonly attachments: AttachmentsService,
    @Inject(MAILBOX_SOURCE) private readonly source: MailboxSource,
    config: ConfigService<Env, true>,
  ) {
    this.ownAddress = mailboxAddress(config.get('MAIL_FROM', { infer: true }));
    this.internalDomains = config.get('INTERNAL_EMAIL_DOMAINS', { infer: true });
    this.rateLimit = config.get('INBOUND_RATE_LIMIT_PER_HOUR', { infer: true });
    this.batchSize = config.get('MAILBOX_BATCH_SIZE', { infer: true });
  }

  /** Cursor em `app_settings` (RN-01 a RN-03). */
  readonly cursorStore: CursorStore = {
    get: async () => {
      const rows = await this.prisma.appSetting.findMany({
        where: { key: { in: [CURSOR_UID, CURSOR_VALIDITY] } },
      });
      const uid = rows.find((row) => row.key === CURSOR_UID)?.value;
      const validity = rows.find((row) => row.key === CURSOR_VALIDITY)?.value;
      return uid === undefined || validity === undefined
        ? null
        : { uidValidity: validity, lastUid: Number(uid) };
    },
    set: async (cursor) => {
      await this.prisma.$transaction([
        this.prisma.appSetting.upsert({
          where: { key: CURSOR_UID },
          update: { value: String(cursor.lastUid) },
          create: { key: CURSOR_UID, value: String(cursor.lastUid) },
        }),
        this.prisma.appSetting.upsert({
          where: { key: CURSOR_VALIDITY },
          update: { value: cursor.uidValidity },
          create: { key: CURSOR_VALIDITY, value: cursor.uidValidity },
        }),
      ]);
    },
    lastReceivedAt: async () => {
      const latest = await this.prisma.inboundEmail.findFirst({
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      });
      return latest?.receivedAt ?? null;
    },
  };

  /**
   * Um ciclo (cron de 1 min): até `MAILBOX_BATCH_SIZE` e-mails. Falha de infraestrutura para o ciclo
   * sem avançar o cursor (RN-04); o próximo minuto tenta de novo.
   */
  async pollMailbox(source: MailboxSource = this.source): Promise<PollResult> {
    const result: PollResult = { processed: 0, discarded: 0, failed: 0, duplicates: 0 };
    const session = await source.open(this.cursorStore);
    try {
      for (const email of await session.next(this.batchSize)) {
        const outcome = await this.processOne(email);
        if (outcome === 'duplicate') result.duplicates += 1;
        else result[outcome] += 1;
        await session.done(email, outcome === 'duplicate' ? 'processed' : outcome);
      }
    } finally {
      await session.close();
    }
    return result;
  }

  /** O destino de um e-mail. Só lança em falha de infraestrutura (banco ou storage). */
  async processOne(email: RawEmail): Promise<InboundOutcome> {
    let parsed: ParsedMail | null = null;
    try {
      parsed = await simpleParser(email.raw, { keepCidLinks: true });
    } catch {
      // Tratado abaixo como `failed`: um e-mail ilegível não pode travar a caixa.
    }
    const messageId =
      parsed?.messageId?.match(MESSAGE_IDS)?.[0] ??
      `<sem-id-${createHash('sha256').update(email.raw).digest('hex')}@inbound>`;

    // RN-05: idempotência antes de qualquer gravação.
    const seen = await this.prisma.inboundEmail.findUnique({
      where: { messageId },
      select: { id: true },
    });
    if (seen) {
      this.logger.log(`E-mail UID ${email.uid}: Message-ID já processado`);
      return 'duplicate';
    }

    const rawStorageKey = await this.attachments.storeRawEmail(email.raw);
    if (!parsed) {
      return this.fail(
        email,
        {
          messageId,
          imapUid: BigInt(email.uid),
          fromEmail: '',
          subject: null,
          rawStorageKey,
          receivedAt: email.internalDate,
        },
        'parse_error',
      );
    }
    const sender = parsed.from?.value[0];
    const fromEmail = sender?.address?.trim().toLowerCase() ?? '';
    const row: InboundRow = {
      messageId,
      imapUid: BigInt(email.uid),
      fromEmail,
      subject: parsed.subject?.slice(0, 998) ?? null,
      rawStorageKey,
      receivedAt: email.internalDate,
    };
    if (!fromEmail.includes('@')) return this.fail(email, row, 'no_sender');

    const reason = await this.discardReason(parsed, fromEmail);
    if (reason) return this.discard(email, row, reason);

    try {
      const ticketNumber = await this.deliver(parsed, row, sender?.name ?? '');
      this.logger.log(`E-mail UID ${email.uid} → ticket #${ticketNumber}`);
      return 'processed';
    } catch (error) {
      const message =
        error instanceof InboundRejection
          ? error.message
          : `error: ${error instanceof Error ? error.message : 'desconhecido'}`;
      // Se nem a falha consegue ser gravada, o banco caiu: propaga e o ciclo para (RN-04).
      return this.fail(email, row, message.slice(0, 500));
    }
  }

  /** RN-08 e RN-09: cabeçalhos, depois remetente inativo e limite por hora. */
  private async discardReason(
    parsed: ParsedMail,
    fromEmail: string,
  ): Promise<DiscardReason | null> {
    const byHeader = headerDiscardReason(parsed.headers, fromEmail, this.ownAddress);
    if (byHeader) return byHeader;
    const user = await this.users.findByEmail(fromEmail);
    if (user && !user.active) return 'inactive_sender';
    const lastHour = await this.prisma.inboundEmail.count({
      where: { fromEmail, createdAt: { gte: new Date(Date.now() - HOUR_MS) } },
    });
    return lastHour >= this.rateLimit ? 'rate_limited' : null;
  }

  /** RN-10 a RN-19. Devolve o número do ticket que recebeu o e-mail. */
  private async deliver(parsed: ParsedMail, row: InboundRow, senderName: string): Promise<number> {
    const domain = row.fromEmail.split('@').pop() ?? '';
    const user = await this.users.findOrCreateFromEmail({
      email: row.fromEmail,
      name: senderName.trim() || row.fromEmail.split('@')[0]!,
      isExternal: !this.internalDomains.includes(domain),
    });
    const author: EmailAuthor = { id: user.id, roles: user.roles, companyId: user.companyId };

    const files: IncomingFile[] = parsed.attachments.map((attachment, index) => ({
      filename: attachmentName(attachment.filename, attachment.contentType, index),
      buffer: attachment.content,
    }));
    const { accepted, rejected } = this.attachments.partition(files);
    const body = emailBody(parsed.html || null, parsed.text ?? null, rejected);
    const stored = await this.attachments.storeAll(accepted);

    let ticketNumber = 0;
    const write: EmailWrite = async (tx, ticket) => {
      ticketNumber = ticket.number;
      await this.recordProcessed(tx, row, ticket.id);
    };

    try {
      const target = await this.resolveTicket(parsed, author);
      if (target && target.status !== 'closed') {
        const result = await this.tickets.addEmailMessage(author, target.id, body, stored, write);
        if (result === 'added') return ticketNumber;
      }
      // RN-13: resposta a ticket fechado abre um novo, ligado ao anterior.
      const category = await this.categories.findActiveByName(DEFAULT_CATEGORY);
      if (!category?.defaultGroup.active) throw new InboundRejection('no_default_category');
      await this.tickets.createFromEmail(
        author,
        {
          subject: ticketSubject(parsed.subject),
          categoryId: category.id,
          groupId: category.defaultGroup.id,
          ...body,
          ...(target ? { relatedTicketId: target.id } : {}),
        },
        stored,
        write,
      );
      return ticketNumber;
    } catch (error) {
      await this.attachments.discard(stored);
      throw error;
    }
  }

  /**
   * RN-11: refs (`In-Reply-To`, depois `References`) → tag `[#n]`, esta só do solicitante ou de
   * agentes → nenhum (ticket novo).
   */
  private async resolveTicket(parsed: ParsedMail, author: EmailAuthor) {
    const ids = referencedIds(parsed);
    if (ids.length > 0) {
      const refs = await this.prisma.emailMessageRef.findMany({
        where: { messageId: { in: ids } },
        select: { messageId: true, ticketId: true },
      });
      for (const id of ids) {
        const ref = refs.find((candidate) => candidate.messageId === id);
        if (ref) {
          const ticket = await this.tickets.findEmailTarget({ id: ref.ticketId });
          if (ticket) return ticket;
        }
      }
    }
    const tag = TAG.exec(parsed.subject ?? '');
    if (!tag) return null;
    const ticket = await this.tickets.findEmailTarget({ number: Number(tag[1]) });
    const roles = author.roles.filter(
      (role): role is 'admin' | 'supervisor' | 'agente' =>
        role === 'admin' || role === 'supervisor' || role === 'agente',
    );
    if (ticket && (ticket.requesterId === author.id || isAgent({ roles }))) return ticket;
    return null;
  }

  /** RN-16: o e-mail e a ref do `Message-ID` entram na transação do ticket. */
  private async recordProcessed(tx: Prisma.TransactionClient, row: InboundRow, ticketId: string) {
    await tx.inboundEmail.create({
      data: { ...row, ticketId, status: 'processed', processedAt: new Date() },
    });
    await tx.emailMessageRef.createMany({
      data: { messageId: row.messageId, ticketId, direction: 'inbound' },
      skipDuplicates: true,
    });
  }

  private async discard(email: RawEmail, row: InboundRow, reason: DiscardReason) {
    await this.prisma.inboundEmail.create({
      data: { ...row, status: 'discarded', reason, processedAt: new Date() },
    });
    const log = `E-mail UID ${email.uid} descartado: ${reason}`;
    if (reason === 'rate_limited') this.logger.warn(log);
    else this.logger.log(log);
    return 'discarded' as const;
  }

  private async fail(email: RawEmail, row: InboundRow, reason: string) {
    await this.prisma.inboundEmail.create({
      data: { ...row, status: 'failed', reason, processedAt: new Date() },
    });
    this.logger.error(`E-mail UID ${email.uid} com falha: ${reason.split(':', 1)[0]}`);
    return 'failed' as const;
  }
}
