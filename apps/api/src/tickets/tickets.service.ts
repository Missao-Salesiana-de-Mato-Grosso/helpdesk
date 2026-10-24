import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiErrorCode,
  type CreateTicketData,
  type ListTicketsQuery,
  type TicketCounters,
  type TicketDetail,
  type TicketListResponse,
  type TicketStatus,
  type TicketView,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { htmlHasContent, sanitizeHtml } from '../common/sanitize-html.js';
import { CategoriesService } from '../categories/categories.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { isAgent, seesAllTickets, type ScopeUser } from './ticket-scope.js';
import { toTicketDetail, toTicketSummary } from './tickets.mapper.js';
import { TicketEventsRepository, TicketsRepository } from './tickets.repository.js';

/**
 * Quem age sobre os tickets: o usuário da requisição (`CurrentUser` satisfaz) ou, na T21,
 * o ator do sistema (`system@helpdesk.local`).
 */
export interface TicketActor extends ScopeUser {
  companyId: string | null;
}

/** Eventos de domínio emitidos depois do commit. A T14 (notificações) os assina. */
export const TicketDomainEvent = {
  created: 'ticket.created',
} as const;

export interface TicketCreatedEvent {
  ticketId: string;
  number: number;
  actorId: string;
  requesterId: string;
  source: 'portal' | 'agent' | 'email';
}

const AGENT_DEFAULT_STATUSES: TicketStatus[] = ['open', 'pending'];
const OPEN_STATUSES: TicketStatus[] = ['open', 'pending'];

const notFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Ticket não encontrado.');
const forbidden = (message: string) =>
  new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.FORBIDDEN_ROLE, message);
const inactiveReference = (message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.INACTIVE_REFERENCE, message);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SORTS: Record<ListTicketsQuery['sort'], Prisma.TicketOrderByWithRelationInput[]> = {
  'updated_at:desc': [{ updatedAt: 'desc' }, { number: 'desc' }],
  'created_at:asc': [{ createdAt: 'asc' }, { number: 'asc' }],
  'created_at:desc': [{ createdAt: 'desc' }, { number: 'desc' }],
  // O enum do Postgres ordena pela declaração (low < medium < high < urgent).
  'priority:desc': [{ priority: 'desc' }, { updatedAt: 'desc' }],
  'number:asc': [{ number: 'asc' }],
  'number:desc': [{ number: 'desc' }],
};

/** Corpo sanitizado; vazio depois de sanitizar → 422 EMPTY_BODY (RN-33). */
export function cleanBody(html: string): string {
  const clean = sanitizeHtml(html);
  if (!htmlHasContent(clean)) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ApiErrorCode.EMPTY_BODY,
      'A mensagem está vazia.',
    );
  }
  return clean;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly events: TicketEventsRepository,
    private readonly users: UsersService,
    private readonly categories: CategoriesService,
    private readonly companies: CompaniesService,
    private readonly emitter: EventEmitter2,
  ) {}

  async detail(viewer: ScopeUser, id: string): Promise<TicketDetail> {
    if (!UUID.test(id)) throw notFound();
    const row = await this.tickets.findDetail(viewer, id);
    if (!row) throw notFound();
    return toTicketDetail(row);
  }

  /** RN-04 a RN-11. */
  async create(
    actor: TicketActor,
    input: CreateTicketData,
    ip: string | null,
  ): Promise<TicketDetail> {
    const requester = await this.resolveRequester(actor, input.requesterId);
    const source = requester.id === actor.id ? 'portal' : 'agent';

    const companyId = input.companyId ?? requester.companyId;
    if (companyId === null) {
      if (!isAgent(actor)) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ApiErrorCode.COMPANY_REQUIRED,
          'Informe a unidade do chamado.',
        );
      }
    } else if (!(await this.companies.isActive(companyId))) {
      throw inactiveReference('Unidade inexistente ou inativa.');
    }

    const category = await this.categories.findActive(input.categoryId);
    if (!category) throw inactiveReference('Categoria inexistente ou inativa.');
    if (!category.defaultGroup.active) {
      throw inactiveReference('O grupo responsável por esta categoria está inativo.');
    }

    if (
      input.relatedTicketId &&
      !(await this.tickets.existsInScope(requester, input.relatedTicketId))
    ) {
      throw notFound();
    }

    const bodyHtml = cleanBody(input.bodyHtml);

    const created = await this.tickets.transaction(async (tx) => {
      const ticket = await this.tickets.create(tx, {
        subject: input.subject,
        priority: input.priority,
        source,
        requesterId: requester.id,
        groupId: category.defaultGroup.id,
        categoryId: category.id,
        companyId,
      });
      await this.tickets.addMessage(tx, {
        ticketId: ticket.id,
        authorId: actor.id,
        kind: 'public',
        via: 'portal',
        bodyHtml,
      });
      await this.events.append(tx, {
        ticketId: ticket.id,
        actorId: actor.id,
        type: 'created',
        data: input.relatedTicketId ? { relatedTicketId: input.relatedTicketId } : {},
        ip,
      });
      return ticket;
    });

    this.emitter.emit(TicketDomainEvent.created, {
      ticketId: created.id,
      number: created.number,
      actorId: actor.id,
      requesterId: requester.id,
      source,
    } satisfies TicketCreatedEvent);

    return toTicketDetail(await this.tickets.loadAfterWrite(actor, created.id));
  }

  /** RN-12 a RN-17. */
  async list(viewer: ScopeUser, query: ListTicketsQuery): Promise<TicketListResponse> {
    const view = query.view ?? this.defaultView(viewer);
    if (!isAgent(viewer) && view !== 'requested') {
      throw forbidden('Esta visão é só para agentes.');
    }

    const statuses = query.status ?? (view === 'requested' ? undefined : AGENT_DEFAULT_STATUSES);
    const filters: Prisma.TicketWhereInput[] = [this.viewFilter(viewer, view)];
    if (statuses) filters.push({ status: { in: statuses } });
    if (query.priority) filters.push({ priority: { in: query.priority } });
    if (query.noCompany) filters.push({ companyId: null });
    else if (query.companyId) filters.push({ companyId: query.companyId });
    if (query.groupId) filters.push({ groupId: query.groupId });
    const search = searchFilter(query.q);
    if (search) filters.push(search);

    const { rows, total } = await this.tickets.list(viewer, { AND: filters }, SORTS[query.sort], {
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items: rows.map(toTicketSummary), total, page: query.page, pageSize: query.pageSize };
  }

  /** RN-18: contadores das filas do agente (abertos e pendentes, dentro do escopo). */
  async counters(viewer: ScopeUser): Promise<TicketCounters> {
    const open: Prisma.TicketWhereInput = { status: { in: OPEN_STATUSES } };
    const [mine, group, unassigned, noCompany] = await Promise.all([
      this.tickets.count(viewer, { AND: [open, this.viewFilter(viewer, 'mine')] }),
      this.tickets.count(viewer, { AND: [open, this.viewFilter(viewer, 'group')] }),
      this.tickets.count(viewer, { AND: [open, this.viewFilter(viewer, 'unassigned')] }),
      this.tickets.count(viewer, { AND: [open, { companyId: null }] }),
    ]);
    return { mine, group, unassigned, noCompany };
  }

  private defaultView(viewer: ScopeUser): TicketView {
    if (seesAllTickets(viewer)) return 'all';
    return isAgent(viewer) ? 'group' : 'requested';
  }

  /** RN-13. Aplicado por cima do `ticketScope`, que o repositório sempre inclui. */
  private viewFilter(viewer: ScopeUser, view: TicketView): Prisma.TicketWhereInput {
    const myGroups = { groupId: { in: [...viewer.groupIds] } };
    const filters: Record<TicketView, Prisma.TicketWhereInput> = {
      requested: { requesterId: viewer.id },
      mine: { assigneeId: viewer.id },
      group: myGroups,
      unassigned: seesAllTickets(viewer) ? { assigneeId: null } : { assigneeId: null, ...myGroups },
      all: {},
    };
    return filters[view];
  }

  /** RN-05: `requesterId` só para agente+, e precisa existir (pode ser terceiro). */
  private async resolveRequester(
    actor: TicketActor,
    requesterId: string | undefined,
  ): Promise<TicketActor> {
    if (requesterId === undefined || requesterId === actor.id) return actor;
    if (!isAgent(actor)) throw forbidden('Só agentes abrem chamados em nome de outra pessoa.');
    const user = await this.users.findById(requesterId);
    if (!user) throw inactiveReference('Solicitante inexistente.');
    return {
      id: user.id,
      roles: user.roles.filter(
        (role) => role === 'admin' || role === 'supervisor' || role === 'agente',
      ),
      groupIds: user.groupMemberships.map((m) => m.groupId),
      companyId: user.companyId,
    };
  }
}

/** RN-15: `#1001` ou `1001` → número; texto com 2+ caracteres → assunto; o resto é ignorado. */
export function searchFilter(q: string | undefined): Prisma.TicketWhereInput | null {
  const term = q?.trim() ?? '';
  const number = /^#?(\d+)$/.exec(term);
  if (number) {
    const value = Number(number[1]);
    return Number.isSafeInteger(value) && value <= 2_147_483_647
      ? { number: value }
      : { id: { in: [] } };
  }
  if (term.length < 2) return null;
  return { subject: { contains: term, mode: 'insensitive' } };
}
