import { Injectable } from '@nestjs/common';
import type { TicketStatus } from '@helpdesk/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isAgent, ticketScope, type ScopeUser } from './ticket-scope.js';

export type Tx = Prisma.TransactionClient;

const person = { select: { id: true, name: true } } as const;
const ref = { select: { id: true, name: true } } as const;

/** Mensagens e eventos que um usuário pode ver (RN-19): a omissão é feita na query. */
function visibility(viewer: Pick<ScopeUser, 'roles'>) {
  const agent = isAgent(viewer);
  return {
    messages: agent ? {} : { kind: 'public' as const },
    events: agent
      ? {}
      : { NOT: { type: 'message_added', data: { path: ['kind'], equals: 'internal' } } },
  };
}

function detailInclude(viewer: Pick<ScopeUser, 'roles'>) {
  const visible = visibility(viewer);
  return {
    requester: {
      select: {
        id: true,
        name: true,
        email: true,
        isExternal: true,
        company: ref,
        department: ref,
      },
    },
    assignee: person,
    group: ref,
    category: ref,
    company: ref,
    messages: {
      where: visible.messages,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        author: { select: { id: true, name: true, roles: true } },
        attachments: {
          select: { id: true, filename: true, mimeType: true, sizeBytes: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    },
    events: {
      where: visible.events,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: person },
    },
  } satisfies Prisma.TicketInclude;
}

function summaryInclude(viewer: Pick<ScopeUser, 'roles'>) {
  return {
    requester: { select: { id: true, name: true, isExternal: true } },
    assignee: person,
    group: ref,
    category: ref,
    company: ref,
    messages: {
      where: visibility(viewer).messages,
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { createdAt: true },
    },
  } satisfies Prisma.TicketInclude;
}

export type TicketDetailRow = Prisma.TicketGetPayload<{
  include: ReturnType<typeof detailInclude>;
}>;
export type TicketSummaryRow = Prisma.TicketGetPayload<{
  include: ReturnType<typeof summaryInclude>;
}>;

const lockedState = {
  id: true,
  number: true,
  subject: true,
  status: true,
  priority: true,
  version: true,
  requesterId: true,
  assigneeId: true,
  groupId: true,
  categoryId: true,
  companyId: true,
  firstResponseAt: true,
} satisfies Prisma.TicketSelect;

export type LockedTicket = Prisma.TicketGetPayload<{ select: typeof lockedState }>;

export type TicketChanges = Pick<
  Prisma.TicketUncheckedUpdateInput,
  | 'status'
  | 'priority'
  | 'assigneeId'
  | 'groupId'
  | 'categoryId'
  | 'companyId'
  | 'firstResponseAt'
  | 'resolvedAt'
  | 'closedAt'
>;

export interface NewTicket {
  subject: string;
  priority: Prisma.TicketCreateInput['priority'];
  source: Prisma.TicketCreateInput['source'];
  requesterId: string;
  groupId: string;
  categoryId: string;
  companyId: string | null;
}

export interface NewMessage {
  ticketId: string;
  authorId: string;
  kind: 'public' | 'internal';
  via: 'portal' | 'email';
  bodyHtml: string;
  quotedHtml?: string | null;
}

/**
 * Acesso a `tickets` e `ticket_messages`. Toda leitura aplica `ticketScope` (RN-01); a única
 * exceção é `loadAfterWrite`, usada para devolver o resultado de uma escrita já autorizada.
 */
@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /** Detalhe dentro do escopo; `null` se não existe ou está fora (o chamador responde 404). */
  findDetail(viewer: ScopeUser, id: string): Promise<TicketDetailRow | null> {
    return this.prisma.ticket.findFirst({
      where: { AND: [ticketScope(viewer), { id }] },
      include: detailInclude(viewer),
    });
  }

  /** Só para o retorno de uma escrita autorizada (ex.: agente que move o ticket para outro grupo). */
  loadAfterWrite(viewer: Pick<ScopeUser, 'roles'>, id: string): Promise<TicketDetailRow> {
    return this.prisma.ticket.findUniqueOrThrow({ where: { id }, include: detailInclude(viewer) });
  }

  async existsInScope(viewer: ScopeUser, id: string): Promise<boolean> {
    const found = await this.prisma.ticket.findFirst({
      where: { AND: [ticketScope(viewer), { id }] },
      select: { id: true },
    });
    return found !== null;
  }

  /** Mensagem num ticket do escopo e visível ao usuário (interna só para agente+). */
  async messageVisibleTo(viewer: ScopeUser, messageId: string): Promise<boolean> {
    const found = await this.prisma.ticketMessage.findFirst({
      where: { id: messageId, ticket: ticketScope(viewer), ...visibility(viewer).messages },
      select: { id: true },
    });
    return found !== null;
  }

  async list(
    viewer: ScopeUser,
    filter: Prisma.TicketWhereInput,
    orderBy: Prisma.TicketOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ): Promise<{ rows: TicketSummaryRow[]; total: number }> {
    const where = { AND: [ticketScope(viewer), filter] };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy,
        skip: page.skip,
        take: page.take,
        include: summaryInclude(viewer),
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { rows, total };
  }

  count(viewer: ScopeUser, filter: Prisma.TicketWhereInput): Promise<number> {
    return this.prisma.ticket.count({ where: { AND: [ticketScope(viewer), filter] } });
  }

  /**
   * Trava a linha do ticket (`SELECT ... FOR UPDATE`) e devolve o estado atual, dentro do escopo.
   * `null` se não existe ou está fora do escopo. Serializa escritas concorrentes no mesmo ticket.
   */
  async lockInScope(tx: Tx, viewer: ScopeUser, id: string): Promise<LockedTicket | null> {
    await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.ticket.findFirst({
      where: { AND: [ticketScope(viewer), { id }] },
      select: lockedState,
    });
  }

  /** Grava as mudanças; `bumpVersion` incrementa `version` (RN-22). Sempre atualiza `updated_at`. */
  async update(tx: Tx, id: string, changes: TicketChanges, bumpVersion: boolean): Promise<void> {
    await tx.ticket.update({
      where: { id },
      data: {
        ...changes,
        ...(bumpVersion ? { version: { increment: 1 } } : {}),
        updatedAt: new Date(),
      },
    });
  }

  async create(
    tx: Tx,
    data: NewTicket,
  ): Promise<{ id: string; number: number; status: TicketStatus }> {
    return tx.ticket.create({ data, select: { id: true, number: true, status: true } });
  }

  /** Ticket que um e-mail referencia (T21), por id ou número, dentro do escopo do leitor. */
  findEmailTarget(
    viewer: ScopeUser,
    where: { id: string } | { number: number },
  ): Promise<{ id: string; number: number; requesterId: string; status: TicketStatus } | null> {
    return this.prisma.ticket.findFirst({
      where: { AND: [ticketScope(viewer), where] },
      select: { id: true, number: true, requesterId: true, status: true },
    });
  }

  async addMessage(tx: Tx, data: NewMessage): Promise<{ id: string }> {
    return tx.ticketMessage.create({ data, select: { id: true } });
  }
}

export interface NewEvent {
  ticketId: string;
  actorId: string;
  type: string;
  data?: Prisma.InputJsonObject;
  ip?: string | null;
}

/** `ticket_events` é append-only: este repositório só insere (CT-50). */
@Injectable()
export class TicketEventsRepository {
  async append(tx: Tx, event: NewEvent): Promise<void> {
    await tx.ticketEvent.create({
      data: {
        ticketId: event.ticketId,
        actorId: event.actorId,
        type: event.type,
        data: event.data ?? {},
        ip: event.ip ?? null,
      },
    });
  }
}
