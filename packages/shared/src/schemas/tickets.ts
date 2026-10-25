import { z } from 'zod';
import type { NamedRef } from './me.js';

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
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketSource = (typeof TICKET_SOURCES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageVia = (typeof MESSAGE_VIAS)[number];
export type TicketView = (typeof TICKET_VIEWS)[number];
export type TicketSort = (typeof TICKET_SORTS)[number];

/** 100 KB de HTML bruto (antes da sanitização). */
export const MAX_BODY_HTML_LENGTH = 100 * 1024;

const bodyHtml = z
  .string()
  .max(MAX_BODY_HTML_LENGTH, 'A mensagem passa do limite de 100 KB')
  .min(1, 'Escreva a mensagem');

/** `POST /api/tickets` (RN-04). */
export const createTicketSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(3, 'O assunto precisa de ao menos 3 caracteres')
      .max(200, 'O assunto pode ter no máximo 200 caracteres'),
    bodyHtml,
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

/** `POST /api/tickets/:id/messages` (RN-31, RN-36). */
export const createMessageSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    bodyHtml,
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
}

export interface TicketMessage {
  id: string;
  kind: MessageKind;
  via: MessageVia;
  bodyHtml: string;
  quotedHtml: string | null;
  author: TicketPerson & { isAgent: boolean };
  /** Preenchido pela T13. */
  attachments: never[];
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
  messages: TicketMessage[];
  events: TicketEvent[];
  /** Nomes dos ids citados em `events[].data` (responsável, grupo, unidade, categoria). */
  refs: Record<string, string>;
}
