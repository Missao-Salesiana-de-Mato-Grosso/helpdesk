import { z } from 'zod';
import type { ApiErrorCode } from '../api-error.js';
import { INLINE_IMAGE_KEY, INLINE_IMAGE_MAX_FILES } from '../attachments.js';
import type { NamedRef } from './me.js';
import type { TicketSla } from './sla.js';

// Enums de domínio (iguais aos do Prisma). Spec docs/specs/T08-T10-tickets-core.md.
export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TICKET_SOURCES = ['portal', 'agent', 'email'] as const;
export const MESSAGE_KINDS = ['public', 'internal'] as const;
export const MESSAGE_VIAS = ['portal', 'email'] as const;
export const TICKET_VIEWS = ['requested', 'mine', 'group', 'unassigned', 'all'] as const;
export const TICKET_SORTS = [
  'updated_at:desc',
  'created_at:asc',
  'created_at:desc',
  'priority:desc',
  'number:asc',
  'number:desc',
  'resolution_due:asc',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketSource = (typeof TICKET_SOURCES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageVia = (typeof MESSAGE_VIAS)[number];
export type TicketView = (typeof TICKET_VIEWS)[number];
export type TicketSort = (typeof TICKET_SORTS)[number];

/** Rótulos da UI. Ficam aqui porque a busca (`q`, RN-15) também casa por eles na API. */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Aberto',
  pending: 'Pendente',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

/** 100 KB de HTML bruto (antes da sanitização). */
export const MAX_BODY_HTML_LENGTH = 100 * 1024;

const bodyHtml = z
  .string()
  .max(MAX_BODY_HTML_LENGTH, 'A mensagem passa do limite de 100 KB')
  .min(1, 'Escreva a mensagem');

/**
 * T32: chaves das imagens inseridas no texto, na ordem dos arquivos do campo multipart `inline`.
 * No `bodyHtml`, cada imagem é `<img data-inline-key="<chave>">`.
 */
export const inlineImagesSchema = z
  .array(z.string().regex(INLINE_IMAGE_KEY, 'Chave de imagem inválida'))
  .max(INLINE_IMAGE_MAX_FILES, `Envie no máximo ${INLINE_IMAGE_MAX_FILES} imagens no texto`)
  .refine((keys) => new Set(keys).size === keys.length, 'Chave de imagem repetida');

/** `POST /api/tickets` (RN-04). */
export const createTicketSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(3, 'O assunto precisa de ao menos 3 caracteres')
      .max(200, 'O assunto pode ter no máximo 200 caracteres'),
    bodyHtml,
    inlineImages: inlineImagesSchema.optional(),
    categoryId: z.uuid(),
    priority: z.enum(TICKET_PRIORITIES).default('medium'),
    companyId: z.uuid().optional(),
    requesterId: z.uuid().optional(),
    relatedTicketId: z.uuid().optional(),
  })
  .strict();

export type CreateTicketInput = z.input<typeof createTicketSchema>;
export type CreateTicketData = z.output<typeof createTicketSchema>;

// Query string: um valor (`?status=open`) ou vários (`?status=open&status=pending`).
const queryList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(item).min(1).optional(),
  );

const queryBoolean = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().optional(),
);

/** `GET /api/tickets` (RN-12 a RN-17). */
export const listTicketsQuerySchema = z
  .object({
    view: z.enum(TICKET_VIEWS).optional(),
    status: queryList(z.enum(TICKET_STATUSES)),
    priority: queryList(z.enum(TICKET_PRIORITIES)),
    companyId: z.uuid().optional(),
    noCompany: queryBoolean,
    groupId: z.uuid().optional(),
    /** T28: abertos com a 1ª resposta ou a resolução vencida. */
    slaBreached: queryBoolean,
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(TICKET_SORTS).default('updated_at:desc'),
  })
  .strict();

export type ListTicketsQuery = z.output<typeof listTicketsQuerySchema>;

/** `PATCH /api/tickets/:id` (RN-21). */
export const updateTicketSchema = z
  .object({
    version: z.number().int().min(1),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    groupId: z.uuid().optional(),
    assigneeId: z.uuid().nullable().optional(),
    categoryId: z.uuid().optional(),
    companyId: z.uuid().optional(),
    applyCompanyToRequester: z.boolean().optional(),
  })
  .strict();

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

/** T35 RN-02: chamados por operação em lote. */
export const MAX_BULK_TICKETS = 100;

const BULK_FIELDS = [
  'status',
  'priority',
  'groupId',
  'assigneeId',
  'categoryId',
  'companyId',
] as const;

export type BulkUpdateField = (typeof BULK_FIELDS)[number];

/** `PATCH /api/tickets/bulk` (T35 RN-02, RN-03): até 100 chamados, exatamente um campo. */
export const bulkUpdateTicketsSchema = z
  .object({
    tickets: z
      .array(z.object({ id: z.uuid(), version: z.number().int().min(1) }).strict())
      .min(1, 'Selecione ao menos um chamado')
      .max(MAX_BULK_TICKETS, `Selecione no máximo ${MAX_BULK_TICKETS} chamados`)
      .refine(
        (tickets) => new Set(tickets.map((ticket) => ticket.id)).size === tickets.length,
        'Chamado repetido',
      ),
    changes: z
      .object({
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        groupId: z.uuid().optional(),
        assigneeId: z.uuid().nullable().optional(),
        categoryId: z.uuid().optional(),
        companyId: z.uuid().optional(),
      })
      .strict()
      .refine(
        (changes) => BULK_FIELDS.filter((field) => changes[field] !== undefined).length === 1,
        'Altere exatamente um campo por vez',
      ),
  })
  .strict();

export type BulkUpdateTicketsInput = z.infer<typeof bulkUpdateTicketsSchema>;

export interface BulkUpdateSuccess {
  id: string;
  ok: true;
  number: number;
  /** `false` quando o chamado já tinha o valor pedido (RN-09). */
  changed: boolean;
  version: number;
}

export interface BulkUpdateFailure {
  id: string;
  ok: false;
  /** Só quando o chamado está no escopo do ator (RN-08). */
  number?: number;
  code: ApiErrorCode;
  message: string;
}

export type BulkUpdateResult = BulkUpdateSuccess | BulkUpdateFailure;

export interface BulkUpdateTicketsResponse {
  results: BulkUpdateResult[];
  succeeded: number;
  failed: number;
}

/** `POST /api/tickets/:id/messages` (RN-31, RN-36). */
export const createMessageSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    bodyHtml,
    inlineImages: inlineImagesSchema.optional(),
    status: z.enum(TICKET_STATUSES).optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((value) => value.status === undefined || value.version !== undefined, {
    message: 'Informe a versão do ticket para mudar o status',
    path: ['version'],
  });

export type CreateMessageInput = z.infer<typeof createMessageSchema>;

// ── Respostas ─────────────────────────────────────────────────────────────────

export interface TicketPerson {
  id: string;
  name: string;
}

export interface TicketSummary {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester: TicketPerson & { isExternal: boolean };
  assignee: TicketPerson | null;
  group: NamedRef;
  company: NamedRef | null;
  category: NamedRef;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  /** T35: para a ação em lote enviar a versão que o agente viu. */
  version: number;
  /** T28: só para agentes. */
  sla: TicketSla | null;
  /** T38: onde o termo da busca apareceu no texto; ausente quando casou só pelos campos. */
  match?: TicketMatch;
}

/** Início e fim de cada parte encontrada no trecho (caracteres de uso privado do Unicode). */
export const TICKET_MATCH_START = '\uE000';
export const TICKET_MATCH_END = '\uE001';

/** T38 RN-08: trecho em texto puro, com as partes encontradas entre os marcadores acima. */
export interface TicketMatch {
  snippet: string;
  source: 'public' | 'internal' | 'attachment';
}

export interface TicketListResponse {
  items: TicketSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TicketCounters {
  mine: number;
  group: number;
  unassigned: number;
  noCompany: number;
  /** T28: abertos com SLA vencido, no escopo do agente. */
  slaBreached: number;
}

export interface TicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** T32: imagem inserida no texto; aparece no corpo, não na lista de anexos. */
  inline: boolean;
}

export interface TicketMessage {
  id: string;
  kind: MessageKind;
  via: MessageVia;
  bodyHtml: string;
  quotedHtml: string | null;
  author: TicketPerson & { isAgent: boolean };
  attachments: TicketAttachment[];
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  type: string;
  actor: TicketPerson;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TicketDetail {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  version: number;
  requester: TicketPerson & {
    email: string;
    isExternal: boolean;
    company: NamedRef | null;
    department: NamedRef | null;
  };
  assignee: TicketPerson | null;
  group: NamedRef;
  category: NamedRef;
  company: NamedRef | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** T28: só para agentes. */
  sla: TicketSla | null;
  messages: TicketMessage[];
  events: TicketEvent[];
  /** Nomes dos ids citados em `events[].data` (responsável, grupo, unidade, categoria). */
  refs: Record<string, string>;
}
