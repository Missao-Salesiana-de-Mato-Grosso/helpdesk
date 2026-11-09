import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ATTACHMENT_MAX_BYTES, DEFAULT_CATEGORY_NAME, attachmentMimeType } from '@helpdesk/shared';
import { AttachmentsService, type StoredFile } from '../attachments/attachments.service.js';
import { sanitizeFilename } from '../attachments/filename.js';
import { htmlHasContent, sanitizeHtml } from '../common/sanitize-html.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { escapeHtml } from '../notifications/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { businessMinutesBetween } from '../sla/business-time.js';
import { SlaService, type SlaContext } from '../sla/sla.service.js';
import { SYSTEM_USER_EMAIL } from '../users/system-user.js';
import {
  bundleSchema,
  extractInlineImages,
  groupNameFor,
  mapPriority,
  normalizeSubject,
  splitQuote,
  type BundlePerson,
  type BundleTicket,
  type GroupRules,
} from './freshdesk-bundle.js';

export interface ImportOptions {
  /** Pasta do pacote (`bundle.json` + `files/`). */
  dir: string;
  /** Sem isto, só simula: lê o banco e monta o relatório, sem gravar nada. */
  apply: boolean;
  /** Chamados do Freshdesk a importar mesmo com possível duplicado. */
  keep: ReadonlySet<number>;
  rules: GroupRules;
}

export type TicketAction = 'import' | 'imported' | 'skip-duplicate' | 'skip-existing' | 'failed';

/** Uma linha do relatório. Só ids, contagens e nomes de grupo: nada de assunto, e-mail ou texto. */
export interface TicketPlan {
  freshdeskId: number;
  status: 'open' | 'pending';
  group: string;
  messages: number;
  attachments: number;
  inlineImages: number;
  /** Números daqui de chamados que parecem o mesmo (mesmo solicitante, assunto e período). */
  duplicateOf: number[];
  action: TicketAction;
  /** Número daqui: o criado agora, ou o que já existia de uma importação anterior. */
  number: number | null;
  error?: string;
}

export interface ImportReport {
  applied: boolean;
  tickets: TicketPlan[];
  /** E-mails que ainda não existem e viram contato (só a contagem). */
  newContacts: number;
  /** Grupos citados pelas regras que não existem (ou estão inativos) aqui. */
  missingGroups: string[];
  /** Anexos fora das regras (tipo ou tamanho): listados no texto da mensagem. */
  rejectedAttachments: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AGENT_ROLES = new Set(['agente', 'supervisor', 'admin']);
const isAgentRoles = (roles: readonly string[]) => roles.some((role) => AGENT_ROLES.has(role));

/** Mensagem pronta para gravar, com os arquivos ainda no pacote. */
interface Draft {
  authorEmail: string;
  createdAt: Date;
  kind: 'public' | 'internal';
  via: 'portal' | 'email';
  bodyHtml: string;
  quotedHtml: string | null;
  files: { path: string; name: string }[];
}

type UserRow = { id: string; roles: string[]; active: boolean; companyId: string | null };
const userSelect = { id: true, roles: true, active: true, companyId: true } as const;

/**
 * T29: importa os chamados abertos do Freshdesk (pacote de scripts/freshdesk-bundle.mjs). Ferramenta
 * de uso único, rodada por linha de comando (freshdesk-import.ts): como o seed, grava direto pelo
 * Prisma, sem passar pelo TicketsService, para manter as datas e os autores originais e não
 * disparar e-mail nenhum. Idempotente: o número do Freshdesk fica em `custom_fields.freshdeskId`.
 */
@Injectable()
export class FreshdeskImportService {
  private readonly internalDomains: readonly string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly sla: SlaService,
    config: ConfigService<Env, true>,
  ) {
    this.internalDomains = config.get('INTERNAL_EMAIL_DOMAINS', { infer: true });
  }

  async run(options: ImportOptions): Promise<ImportReport> {
    const raw: unknown = JSON.parse(await readFile(path.join(options.dir, 'bundle.json'), 'utf8'));
    const bundle = bundleSchema.parse(raw);
    const category = await this.prisma.category.findUnique({
      where: { name: DEFAULT_CATEGORY_NAME },
      select: { id: true, defaultGroup: { select: { id: true, name: true } } },
    });
    if (!category) throw new Error(`Categoria "${DEFAULT_CATEGORY_NAME}" ausente: rode o seed`);
    const system = await this.prisma.user.findUnique({
      where: { email: SYSTEM_USER_EMAIL },
      select: { id: true },
    });
    if (!system) throw new Error(`Ator do sistema (${SYSTEM_USER_EMAIL}) ausente: rode o seed`);
    const groups = new Map(
      (
        await this.prisma.group.findMany({
          where: { active: true },
          select: { id: true, name: true },
        })
      ).map((group) => [group.name, group.id]),
    );

    const missingGroups = new Set<string>();
    const unknownEmails = new Set<string>();
    const plans: { plan: TicketPlan; ticket: BundleTicket; groupId: string | undefined }[] = [];

    for (const ticket of bundle.tickets) {
      const groupName = groupNameFor(ticket, options.rules) ?? category.defaultGroup.name;
      const groupId = groups.get(groupName);
      if (!groupId) missingGroups.add(groupName);
      const existing = await this.prisma.ticket.findFirst({
        where: { customFields: { path: ['freshdeskId'], equals: ticket.freshdeskId } },
        select: { number: true },
      });
      const duplicateOf = existing ? [] : await this.duplicates(ticket);
      const action: TicketAction = existing
        ? 'skip-existing'
        : duplicateOf.length > 0 && !options.keep.has(ticket.freshdeskId)
          ? 'skip-duplicate'
          : 'import';
      if (action === 'import') {
        for (const person of [ticket.requester, ...ticket.messages.map((m) => m.author)]) {
          if (person && !(await this.findUser(person.email))) unknownEmails.add(person.email);
        }
      }
      const inline = [ticket.html, ...ticket.messages.map((m) => m.html)].reduce(
        (total, html) => total + extractInlineImages(html).files.length,
        0,
      );
      plans.push({
        ticket,
        groupId,
        plan: {
          freshdeskId: ticket.freshdeskId,
          status: ticket.status,
          group: groupName,
          messages: ticket.messages.length + 1,
          attachments:
            ticket.attachments.length +
            ticket.messages.reduce((total, m) => total + m.attachments.length, 0),
          inlineImages: inline,
          duplicateOf,
          action,
          number: existing?.number ?? null,
        },
      });
    }

    const report: ImportReport = {
      applied: false,
      tickets: plans.map((item) => item.plan),
      newContacts: unknownEmails.size,
      missingGroups: [...missingGroups],
      rejectedAttachments: 0,
    };
    // Sem todos os grupos, nada é gravado: o relatório diz quais criar (ou qual --map-group usar).
    if (!options.apply || missingGroups.size > 0) return report;

    report.applied = true;
    const context = await this.sla.context();
    const importedAt = new Date();
    for (const { plan, ticket, groupId } of plans) {
      if (plan.action !== 'import' || !groupId) continue;
      try {
        const result = await this.importTicket(ticket, {
          dir: options.dir,
          groupId,
          categoryId: category.id,
          systemId: system.id,
          context,
          importedAt,
        });
        plan.action = 'imported';
        plan.number = result.number;
        report.rejectedAttachments += result.rejected;
      } catch (error) {
        plan.action = 'failed';
        // Só o tipo e o código: a mensagem do Prisma pode citar valores (dados pessoais).
        plan.error =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? `${error.name} ${error.code}`
            : error instanceof Error
              ? error.name
              : 'erro';
      }
    }
    return report;
  }

  /** Chamados daqui (não importados) do mesmo solicitante, com o mesmo assunto, perto da data. */
  private async duplicates(ticket: BundleTicket): Promise<number[]> {
    const requester = await this.findUser(ticket.requester.email);
    if (!requester) return [];
    const created = Date.parse(ticket.createdAt);
    const rows = await this.prisma.ticket.findMany({
      where: {
        requesterId: requester.id,
        createdAt: { gte: new Date(created - DAY_MS), lte: new Date(created + 3 * DAY_MS) },
      },
      select: { number: true, subject: true, customFields: true },
    });
    const subject = normalizeSubject(ticket.subject);
    return rows
      .filter((row) => row.customFields === null)
      .filter((row) => {
        const other = normalizeSubject(row.subject);
        return (
          other === subject ||
          (Math.min(other.length, subject.length) >= 8 &&
            (other.includes(subject) || subject.includes(other)))
        );
      })
      .map((row) => row.number);
  }

  private findUser(email: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { email }, select: userSelect });
  }

  /** O usuário do e-mail, ou um contato novo sem login, como faz o canal de e-mail (T21 RN-10). */
  private async ensureUser(person: BundlePerson): Promise<UserRow> {
    const existing = await this.findUser(person.email);
    if (existing) return existing;
    const domain = person.email.split('@')[1] ?? '';
    return this.prisma.user.create({
      data: {
        email: person.email,
        name: person.name.trim() || person.email.split('@')[0] || person.email,
        isExternal: !this.internalDomains.includes(domain),
      },
      select: userSelect,
    });
  }

  private async importTicket(
    ticket: BundleTicket,
    ctx: {
      dir: string;
      groupId: string;
      categoryId: string;
      systemId: string;
      context: SlaContext;
      importedAt: Date;
    },
  ): Promise<{ number: number; rejected: number }> {
    const requester = await this.ensureUser(ticket.requester);
    const authors = new Map<string, UserRow>([[ticket.requester.email, requester]]);
    for (const message of ticket.messages) {
      if (message.author && !authors.has(message.author.email)) {
        authors.set(message.author.email, await this.ensureUser(message.author));
      }
    }
    const responder = ticket.responder ? await this.findUser(ticket.responder.email) : null;
    const assigneeId =
      responder && responder.active && isAgentRoles(responder.roles) ? responder.id : null;

    const drafts: Draft[] = [
      this.draft(
        ticket.requester.email,
        ticket.createdAt,
        false,
        ticket.source === 'portal' ? 'portal' : 'email',
        ticket.html,
        ticket.attachments,
      ),
      ...ticket.messages.map((message) => {
        const email = message.author?.email ?? ticket.requester.email;
        const fromAgent = isAgentRoles(authors.get(email)?.roles ?? []);
        return this.draft(
          email,
          message.createdAt,
          message.private,
          fromAgent ? 'portal' : 'email',
          message.html,
          message.attachments,
        );
      }),
    ];

    // 1ª resposta: a primeira mensagem pública de um agente que não é o solicitante.
    const firstResponse = drafts.find(
      (draft) =>
        draft.kind === 'public' &&
        draft.authorEmail !== ticket.requester.email &&
        isAgentRoles(authors.get(draft.authorEmail)?.roles ?? []),
    );

    // SLA a partir da importação: o tempo útil entre a abertura e agora conta como pausa.
    const createdAt = new Date(ticket.createdAt);
    const priority = mapPriority(ticket.priority);
    const pausedMinutes =
      ctx.context.calendar.intervals.length > 0
        ? businessMinutesBetween(createdAt, ctx.importedAt, ctx.context.calendar)
        : 0;
    const dues = this.sla.dueDates(ctx.context, {
      createdAt,
      priority,
      slaPausedMinutes: pausedMinutes,
    });

    // Arquivos antes da transação; se ela falhar, saem do storage.
    const storedByDraft: StoredFile[][] = [];
    let rejected = 0;
    try {
      for (const draft of drafts) {
        const stored: StoredFile[] = [];
        const refused: string[] = [];
        for (const file of draft.files) {
          const buffer = await readFile(path.join(ctx.dir, 'files', file.path));
          const name = sanitizeFilename(file.name);
          if (attachmentMimeType(name) === null || buffer.length > ATTACHMENT_MAX_BYTES) {
            refused.push(name);
            continue;
          }
          stored.push(await this.attachments.storeFromBuffer(buffer, { filename: name }));
        }
        if (refused.length > 0) {
          rejected += refused.length;
          draft.bodyHtml += `<p>${escapeHtml(`Anexos não importados do Freshdesk (tipo não aceito ou acima de 20 MB): ${refused.join(', ')}`)}</p>`;
        }
        storedByDraft.push(stored);
      }

      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.ticket.create({
          data: {
            subject: ticket.subject.trim().slice(0, 200) || '(sem assunto)',
            status: ticket.status,
            priority,
            source:
              ticket.source === 'portal' ? 'portal' : ticket.source === 'phone' ? 'agent' : 'email',
            requesterId: requester.id,
            assigneeId,
            groupId: ctx.groupId,
            categoryId: ctx.categoryId,
            companyId: requester.companyId,
            customFields: { freshdeskId: ticket.freshdeskId },
            firstResponseAt: firstResponse?.createdAt ?? null,
            createdAt,
            updatedAt: new Date(ticket.updatedAt),
            ...dues,
            slaPausedAt: ticket.status === 'pending' ? ctx.importedAt : null,
            slaPausedMinutes: pausedMinutes,
          },
          select: { id: true, number: true },
        });
        for (const [index, draft] of drafts.entries()) {
          const message = await tx.ticketMessage.create({
            data: {
              ticketId: row.id,
              authorId: authors.get(draft.authorEmail)?.id ?? requester.id,
              kind: draft.kind,
              via: draft.via,
              bodyHtml: draft.bodyHtml,
              quotedHtml: draft.quotedHtml,
              createdAt: draft.createdAt,
            },
            select: { id: true },
          });
          await this.attachments.createRecords(tx, message.id, storedByDraft[index] ?? []);
        }
        await tx.ticketEvent.create({
          data: {
            ticketId: row.id,
            actorId: ctx.systemId,
            type: 'imported',
            data: { source: 'freshdesk', freshdeskId: ticket.freshdeskId },
          },
        });
        return row;
      });
      return { number: created.number, rejected };
    } catch (error) {
      await this.attachments.discard(storedByDraft.flat());
      throw error;
    }
  }

  /** Texto limpo, citação separada e imagens coladas convertidas em anexo. */
  private draft(
    authorEmail: string,
    createdAt: string,
    isPrivate: boolean,
    via: 'portal' | 'email',
    html: string,
    attachments: { file: string; name: string }[],
  ): Draft {
    const inline = extractInlineImages(html);
    const split = splitQuote(inline.html);
    const body = sanitizeHtml(split.body);
    const quoted = split.quoted === null ? '' : sanitizeHtml(split.quoted);
    return {
      authorEmail,
      createdAt: new Date(createdAt),
      kind: isPrivate ? 'internal' : 'public',
      via,
      bodyHtml: htmlHasContent(body) ? body : '<p>(mensagem sem texto)</p>',
      quotedHtml: quoted && htmlHasContent(quoted) ? quoted : null,
      files: [
        ...attachments.map((attachment) => ({ path: attachment.file, name: attachment.name })),
        ...inline.files.map((file) => ({ path: file, name: path.basename(file) })),
      ],
    };
  }
}
