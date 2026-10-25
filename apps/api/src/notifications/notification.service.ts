import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentsService, type StoredFile } from '../attachments/attachments.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GroupsService } from '../groups/groups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService, type UserContact } from '../users/users.service.js';
import {
  describeFailure,
  isPermanentFailure,
  MAILER,
  type Mailer,
  type OutgoingMail,
} from './mailer.js';
import {
  AUTO_SUBMITTED,
  NOTIFICATION_TEMPLATES,
  notificationPayload,
  renderNotification,
  type NotificationPayload,
  type NotificationTemplate,
} from './templates.js';

/** O ticket como estava na transação que gerou o evento. */
export interface NotifiedTicket {
  id: string;
  number: number;
  subject: string;
  requesterId: string;
  assigneeId: string | null;
  groupId: string;
  companyId: string | null;
  categoryId: string;
}

export interface NotifiedMessage {
  bodyHtml: string;
  attachments: readonly StoredFile[];
}

/** O que os services de tickets (e a T21) informam; o enqueue decide quem recebe (RN-01 a RN-08). */
export type NotificationEvent =
  | { type: 'ticket_created'; ticket: NotifiedTicket; actorId: string; message: NotifiedMessage }
  | {
      type: 'public_reply';
      ticket: NotifiedTicket;
      actorId: string;
      message: NotifiedMessage;
      /** A mesma requisição resolveu o ticket (RN-04): um e-mail só. */
      resolved: boolean;
    }
  | { type: 'resolved'; ticket: NotifiedTicket; actorId: string };

export interface OutboxResult {
  sent: number;
  failed: number;
  retried: number;
}

interface Recipient {
  email: string;
  name: string;
  /** Faz login no portal: recebe o link (RN-07). */
  portal: boolean;
}

/** Uma entrega planejada antes dos filtros da RN-06. */
interface Planned {
  template: NotificationTemplate;
  to: Recipient;
  /** `true` só na confirmação ao solicitante, que vai mesmo se ele causou o evento. */
  includeActor: boolean;
  userId: string | null;
  active: boolean;
}

type GroupTarget = NonNullable<Awaited<ReturnType<GroupsService['notificationTarget']>>>;

/** Linha da outbox que este ciclo reservou. */
type OutboxRow = Prisma.NotificationGetPayload<{
  select: {
    id: true;
    ticketId: true;
    toEmail: true;
    template: true;
    payload: true;
    attempts: true;
    emailMessageId: true;
  };
}>;

/** Por quanto tempo uma linha reservada fica fora do alcance de outro ciclo (ou réplica). */
const LEASE_MS = 5 * 60_000;
const MAX_REFERENCES = 10;

const isTemplate = (value: string): value is NotificationTemplate =>
  (NOTIFICATION_TEMPLATES as readonly string[]).includes(value);

/** Endereço de `Nome <email>` (ou o texto todo), em minúsculas. */
export function mailboxAddress(value: string): string {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();
}

/**
 * Notificações por e-mail (spec T14): `enqueue` grava na outbox dentro da transação do evento;
 * `processOutbox` (cron de 1 min) entrega com retry. Nunca loga corpo, payload nem anexos.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly from: string;
  private readonly ownAddress: string;
  private readonly portalUrl: string;
  private readonly messageIdDomain: string;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly maxAttachmentBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly groups: GroupsService,
    private readonly companies: CompaniesService,
    private readonly categories: CategoriesService,
    private readonly attachments: AttachmentsService,
    @Inject(MAILER) private readonly mailer: Mailer,
    config: ConfigService<Env, true>,
  ) {
    this.from = config.get('MAIL_FROM', { infer: true });
    this.ownAddress = mailboxAddress(this.from);
    this.portalUrl = config.get('PORTAL_URL', { infer: true });
    this.messageIdDomain = config.get('MAIL_MESSAGE_ID_DOMAIN', { infer: true });
    this.batchSize = config.get('NOTIFICATIONS_BATCH_SIZE', { infer: true });
    this.maxAttempts = config.get('NOTIFICATIONS_MAX_ATTEMPTS', { infer: true });
    this.maxAttachmentBytes = config.get('NOTIFICATIONS_MAX_ATTACHMENT_BYTES', { infer: true });
  }

  /** RN-09: chamado dentro da transação que grava o ticket ou a mensagem. Não envia nada. */
  async enqueue(tx: Prisma.TransactionClient, event: NotificationEvent): Promise<void> {
    const { ticket } = event;
    const group = await this.groups.notificationTarget(ticket.groupId);
    const planned = await this.plan(event, group);
    const recipients = this.filter(planned, event.actorId);
    if (recipients.length === 0) return;

    const [contacts, companies, categories] = await Promise.all([
      this.users.contactsByIds([ticket.requesterId, event.actorId]),
      ticket.companyId ? this.companies.namesByIds([ticket.companyId]) : Promise.resolve([]),
      this.categories.namesByIds([ticket.categoryId]),
    ]);
    const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? '';
    const message = event.type === 'resolved' ? null : event.message;

    await tx.notification.createMany({
      data: recipients.map(({ template, to }) => {
        const payload: NotificationPayload = {
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          ticketSubject: ticket.subject,
          recipientName: to.name,
          portalUrl: to.portal ? `${this.portalUrl}/tickets/${ticket.id}` : null,
          authorName: nameOf(event.actorId),
          bodyHtml: message?.bodyHtml ?? null,
          attachments: (message?.attachments ?? []).map((a) => ({
            filename: a.filename,
            storageKey: a.storageKey,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          })),
          resolved: event.type === 'public_reply' && event.resolved,
          groupName: group?.name ?? null,
          requesterName: nameOf(ticket.requesterId),
          companyName: companies[0]?.name ?? null,
          categoryName: categories[0]?.name ?? null,
        };
        return {
          ticketId: ticket.id,
          toEmail: to.email,
          template,
          payload,
          // RN-11: gerado agora, para um reenvio usar o mesmo Message-ID.
          emailMessageId: `<tk-${ticket.id}-${randomUUID()}@${this.messageIdDomain}>`,
        };
      }),
    });
  }

  /** RN-01 a RN-04 e RN-08: quem recebe o quê, antes dos filtros. */
  private async plan(event: NotificationEvent, group: GroupTarget | null): Promise<Planned[]> {
    const { ticket } = event;
    const requester = async (template: NotificationTemplate, includeActor = false) =>
      (await this.users.contactsByIds([ticket.requesterId])).map((user) =>
        userPlanned(template, user, includeActor),
      );

    switch (event.type) {
      case 'ticket_created':
        return [
          ...(await requester('ticket_created', true)),
          ...(await this.groupPlanned('ticket_created_group', group)),
        ];
      case 'public_reply':
        if (event.actorId !== ticket.requesterId) return requester('reply');
        if (ticket.assigneeId) {
          return (await this.users.contactsByIds([ticket.assigneeId])).map((user) =>
            userPlanned('requester_reply', user, false),
          );
        }
        return this.groupPlanned('requester_reply', group);
      default: // resolved
        return requester('resolved');
    }
  }

  /** RN-08: o e-mail do grupo (se não for a própria caixa) ou cada agente ativo. */
  private async groupPlanned(
    template: NotificationTemplate,
    group: GroupTarget | null,
  ): Promise<Planned[]> {
    if (!group) return [];
    if (group.email && mailboxAddress(group.email) !== this.ownAddress) {
      return [
        {
          template,
          to: { email: group.email, name: group.name, portal: true },
          includeActor: false,
          userId: null,
          active: true,
        },
      ];
    }
    const members = await this.users.contactsByIds(group.memberIds);
    return members.map((user) => userPlanned(template, user, false));
  }

  /** RN-06: sem o ator, sem inativos, sem a própria caixa e sem endereço repetido. */
  private filter(planned: Planned[], actorId: string): Planned[] {
    const seen = new Set<string>();
    return planned.filter((item) => {
      const address = item.to.email.toLowerCase();
      if (!item.active || address === this.ownAddress || seen.has(address)) return false;
      if (!item.includeActor && item.userId === actorId) return false;
      seen.add(address);
      return true;
    });
  }

  /** RN-12 a RN-15. O cron chama a cada minuto; os testes chamam direto. */
  async processOutbox(now = new Date()): Promise<OutboxResult> {
    const rows = await this.claim(now);
    const result: OutboxResult = { sent: 0, failed: 0, retried: 0 };
    for (const row of rows) {
      const outcome = await this.deliver(row, now);
      result[outcome] += 1;
    }
    return result;
  }

  /**
   * Reserva o lote com `FOR UPDATE SKIP LOCKED` e empurra o `send_after` (lease): outra réplica
   * não pega as mesmas linhas, e se esta cair no meio, elas voltam depois do lease.
   */
  private async claim(now: Date): Promise<OutboxRow[]> {
    const lease = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE notifications SET send_after = ${lease}
      WHERE id IN (
        SELECT id FROM notifications
        WHERE status = 'pending' AND send_after <= ${now}
        ORDER BY created_at, id
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (claimed.length === 0) return [];
    return this.prisma.notification.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
      select: {
        id: true,
        ticketId: true,
        toEmail: true,
        template: true,
        payload: true,
        attempts: true,
        emailMessageId: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async deliver(row: OutboxRow, now: Date): Promise<keyof OutboxResult> {
    try {
      const mail = await this.compose(row);
      await this.mailer.send(mail);
    } catch (error) {
      return this.recordFailure(row, error, now);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.notification.update({
        where: { id: row.id },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      });
      if (row.ticketId && row.emailMessageId) {
        // Um reenvio depois de queda (RN-11) já pode ter gravado a mesma referência.
        await tx.emailMessageRef.createMany({
          data: { messageId: row.emailMessageId, ticketId: row.ticketId, direction: 'outbound' },
          skipDuplicates: true,
        });
      }
    });
    this.logger.log(`Notificação ${row.id} (${row.template}) enviada`);
    return 'sent';
  }

  private async recordFailure(
    row: OutboxRow,
    error: unknown,
    now: Date,
  ): Promise<keyof OutboxResult> {
    const attempts = row.attempts + 1;
    const giveUp = isPermanentFailure(error) || attempts >= this.maxAttempts;
    const lastError = describeFailure(error);
    await this.prisma.notification.update({
      where: { id: row.id },
      data: giveUp
        ? { status: 'failed', attempts, lastError }
        : {
            attempts,
            lastError,
            // 1, 2, 4, 8, 16 min (RN-14).
            sendAfter: new Date(now.getTime() + 2 ** (attempts - 1) * 60_000),
          },
    });
    const code = lastError.split(' ', 1)[0];
    this.logger.warn(
      `Notificação ${row.id} (${row.template}) falhou na tentativa ${attempts}: ${code}${giveUp ? ' — desistindo' : ''}`,
    );
    return giveUp ? 'failed' : 'retried';
  }

  /** RN-16 a RN-19: assunto, cabeçalhos de thread, corpo e anexos. */
  private async compose(row: OutboxRow): Promise<OutgoingMail> {
    if (!isTemplate(row.template)) throw new Error(`Template desconhecido: ${row.template}`);
    const payload = notificationPayload.parse(row.payload);
    const messageId = row.emailMessageId ?? `<n-${row.id}@${this.messageIdDomain}>`;

    const references = row.ticketId
      ? await this.threadOf(row.ticketId, row.toEmail, messageId)
      : [];

    const attachments = await this.openAttachments(row.id, payload);
    const rendered = renderNotification(row.template, payload, attachments !== null);

    return {
      from: this.from,
      replyTo: this.from,
      to: row.toEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      messageId,
      ...(references.length > 0 ? { inReplyTo: references.at(-1), references } : {}),
      headers: {
        'X-Helpdesk-Ticket': String(payload.ticketNumber),
        ...(AUTO_SUBMITTED[row.template] ? { 'Auto-Submitted': 'auto-generated' } : {}),
      },
      attachments: attachments ?? [],
    };
  }

  /**
   * RN-17: o thread deste destinatário, do mais antigo para o mais novo — os e-mails recebidos
   * no ticket (T21) e os que ele mesmo já recebeu. Avisos a outras pessoas (ao grupo, por exemplo)
   * ficam de fora: ele nunca os viu.
   */
  private async threadOf(ticketId: string, toEmail: string, own: string): Promise<string[]> {
    const [inbound, outbound] = await Promise.all([
      this.prisma.emailMessageRef.findMany({
        where: { ticketId, direction: 'inbound' },
        select: { messageId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_REFERENCES,
      }),
      this.prisma.notification.findMany({
        where: {
          ticketId,
          status: 'sent',
          toEmail: { equals: toEmail, mode: 'insensitive' },
          emailMessageId: { not: own },
        },
        select: { emailMessageId: true, sentAt: true },
        orderBy: { sentAt: 'desc' },
        take: MAX_REFERENCES,
      }),
    ]);
    const entries = [
      ...inbound.map((ref) => ({ id: ref.messageId, at: ref.createdAt.getTime() })),
      ...outbound.flatMap((n) =>
        n.emailMessageId ? [{ id: n.emailMessageId, at: n.sentAt?.getTime() ?? 0 }] : [],
      ),
    ];
    return entries
      .toSorted((a, b) => a.at - b.at)
      .slice(-MAX_REFERENCES)
      .map((entry) => entry.id);
  }

  /** RN-19: os arquivos, se couberem no limite; `null` = só listar os nomes. */
  private async openAttachments(
    id: string,
    payload: NotificationPayload,
  ): Promise<OutgoingMail['attachments'] | null> {
    if (payload.attachments.length === 0) return [];
    const total = payload.attachments.reduce((sum, a) => sum + a.sizeBytes, 0);
    if (total > this.maxAttachmentBytes) return null;
    const opened: OutgoingMail['attachments'] = [];
    try {
      for (const a of payload.attachments) {
        const content = await this.attachments.open(a.storageKey);
        opened.push({ filename: a.filename, contentType: a.mimeType, content });
      }
      return opened;
    } catch {
      for (const a of opened) a.content.destroy();
      this.logger.error(`Notificação ${id}: anexo indisponível no storage; enviando só os nomes`);
      return null;
    }
  }
}

function userPlanned(
  template: NotificationTemplate,
  user: UserContact,
  includeActor: boolean,
): Planned {
  return {
    template,
    to: { email: user.email, name: user.name, portal: !user.isExternal },
    includeActor,
    userId: user.id,
    active: user.active,
  };
}
