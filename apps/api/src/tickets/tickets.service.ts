import type { Readable } from 'node:stream';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiErrorCode,
  type CreateMessageInput,
  type CreateTicketData,
  type ListTicketsQuery,
  type TicketCounters,
  type TicketDetail,
  type TicketListResponse,
  type TicketStatus,
  type TicketView,
  type UpdateTicketInput,
} from '@helpdesk/shared';
import {
  AttachmentsService,
  type AttachmentRecord,
  type IncomingFile,
  type StoredFile,
} from '../attachments/attachments.service.js';
import { StorageObjectNotFoundError } from '../attachments/storage/storage-driver.js';
import { ApiException } from '../common/api-exception.js';
import { htmlHasContent, sanitizeHtml } from '../common/sanitize-html.js';
import { CategoriesService } from '../categories/categories.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { NotificationService, type NotifiedTicket } from '../notifications/notification.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { isAgent, seesAllTickets, type ScopeUser } from './ticket-scope.js';
import { planStatusChange, ticketClosed, versionConflict } from './ticket-status.js';
import { toTicketDetail, toTicketSummary } from './tickets.mapper.js';
import {
  TicketEventsRepository,
  TicketsRepository,
  type LockedTicket,
  type NewEvent,
  type TicketDetailRow,
  type TicketChanges,
  type Tx,
} from './tickets.repository.js';

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
  updated: 'ticket.updated',
  statusChanged: 'ticket.status_changed',
  assigned: 'ticket.assigned',
  messageAdded: 'ticket.message_added',
} as const;

export interface TicketCreatedEvent {
  ticketId: string;
  number: number;
  actorId: string;
  requesterId: string;
  source: 'portal' | 'agent' | 'email';
}

export interface TicketUpdatedEvent {
  ticketId: string;
  actorId: string;
  /** Tipos dos `ticket_events` gravados (ex.: `priority_changed`). */
  changes: string[];
}

export interface TicketStatusChangedEvent {
  ticketId: string;
  actorId: string;
  from: TicketStatus;
  to: TicketStatus;
  reason?: 'requester_reply';
}

export interface TicketAssignedEvent {
  ticketId: string;
  actorId: string;
  from: string | null;
  to: string | null;
}

export interface TicketMessageAddedEvent {
  ticketId: string;
  messageId: string;
  kind: 'public' | 'internal';
  authorId: string;
  authorIsRequester: boolean;
}

type PendingEmit = { name: string; payload: object };

const AGENT_DEFAULT_STATUSES: TicketStatus[] = ['open', 'pending'];
const OPEN_STATUSES: TicketStatus[] = ['open', 'pending'];

const notFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Ticket não encontrado.');
const forbidden = (message: string) =>
  new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.FORBIDDEN_ROLE, message);
const inactiveReference = (message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.INACTIVE_REFERENCE, message);

/** Tipos de evento cujo `data.from`/`data.to` são ids, e de quê. */
const REF_KIND: Partial<Record<string, 'users' | 'groups' | 'companies' | 'categories'>> = {
  assigned: 'users',
  group_changed: 'groups',
  company_changed: 'companies',
  category_changed: 'categories',
};

const attachmentNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Anexo não encontrado.');

const notAssignable = () =>
  new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ApiErrorCode.ASSIGNEE_NOT_IN_GROUP,
    'O responsável precisa ser um agente ativo do grupo do ticket.',
  );

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
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly events: TicketEventsRepository,
    private readonly users: UsersService,
    private readonly categories: CategoriesService,
    private readonly companies: CompaniesService,
    private readonly groups: GroupsService,
    private readonly attachments: AttachmentsService,
    private readonly notifications: NotificationService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** RN-21 a RN-30. O controller já exige agente+. */
  async update(
    actor: TicketActor,
    id: string,
    input: UpdateTicketInput,
    ip: string | null,
  ): Promise<TicketDetail> {
    if (!UUID.test(id)) throw notFound();
    const emits = await this.tickets.transaction(async (tx) => {
      const ticket = await this.lockOrThrow(tx, actor, id);
      if (ticket.status === 'closed') throw ticketClosed();
      if (input.version !== ticket.version) throw versionConflict(ticket.version);

      const changes: TicketChanges = {};
      const events: Omit<NewEvent, 'ticketId' | 'actorId' | 'ip'>[] = [];
      const pending: PendingEmit[] = [];
      const changed = <K extends keyof LockedTicket>(key: K, value: LockedTicket[K] | undefined) =>
        value !== undefined && value !== ticket[key];

      const groupId = input.groupId ?? ticket.groupId;
      const companyId = input.companyId ?? ticket.companyId;

      if (input.companyId !== undefined) {
        if (!(await this.companies.isActive(input.companyId))) {
          throw inactiveReference('Unidade inexistente ou inativa.');
        }
        if (changed('companyId', input.companyId)) {
          changes.companyId = input.companyId;
          events.push(fromTo('company_changed', ticket.companyId, input.companyId));
        }
        // RN-28: a unidade também vai para o solicitante só com a flag.
        if (input.applyCompanyToRequester) {
          await this.users.setCompany(ticket.requesterId, input.companyId, tx);
        }
      }

      if (input.status !== undefined) {
        const plan = planStatusChange(ticket.status, input.status, companyId, new Date());
        if (plan) {
          changes.status = plan.to;
          Object.assign(changes, plan.timestamps);
          events.push(fromTo('status_changed', plan.from, plan.to));
          pending.push(statusEmit(id, actor.id, plan.from, plan.to));
        }
      }

      if (changed('priority', input.priority)) {
        changes.priority = input.priority;
        events.push(fromTo('priority_changed', ticket.priority, input.priority!));
      }

      if (changed('groupId', input.groupId)) {
        if (!(await this.groups.isActive(input.groupId!))) {
          throw inactiveReference('Grupo inexistente ou inativo.');
        }
        changes.groupId = input.groupId;
        events.push(fromTo('group_changed', ticket.groupId, input.groupId!));
      }

      if (changed('categoryId', input.categoryId)) {
        if (!(await this.categories.findActive(input.categoryId!))) {
          throw inactiveReference('Categoria inexistente ou inativa.');
        }
        changes.categoryId = input.categoryId;
        events.push(fromTo('category_changed', ticket.categoryId, input.categoryId!));
      }

      if (changed('assigneeId', input.assigneeId)) {
        const assigneeId = input.assigneeId ?? null;
        if (assigneeId !== null) await this.assertAssignable(actor, assigneeId, groupId);
        changes.assigneeId = assigneeId;
        events.push(fromTo('assigned', ticket.assigneeId, assigneeId));
        pending.push({
          name: TicketDomainEvent.assigned,
          payload: {
            ticketId: id,
            actorId: actor.id,
            from: ticket.assigneeId,
            to: assigneeId,
          } satisfies TicketAssignedEvent,
        });
      }

      if (events.length === 0) return [];
      await this.tickets.update(tx, id, changes, true);
      for (const event of events) {
        await this.events.append(tx, { ...event, ticketId: id, actorId: actor.id, ip });
      }
      if (changes.status === 'resolved') {
        await this.notifications.enqueue(tx, {
          type: 'resolved',
          ticket: notified(ticket, {
            assigneeId: input.assigneeId === undefined ? ticket.assigneeId : input.assigneeId,
            groupId,
            companyId,
            categoryId: input.categoryId ?? ticket.categoryId,
          }),
          actorId: actor.id,
        });
      }
      pending.push({
        name: TicketDomainEvent.updated,
        payload: {
          ticketId: id,
          actorId: actor.id,
          changes: events.map((e) => e.type),
        } satisfies TicketUpdatedEvent,
      });
      return pending;
    });

    this.emitAll(emits);
    return this.toDetail(await this.tickets.loadAfterWrite(actor, id));
  }

  /** RN-31 a RN-39. */
  async addMessage(
    actor: TicketActor,
    id: string,
    input: CreateMessageInput,
    ip: string | null,
    files: readonly IncomingFile[] = [],
  ): Promise<TicketDetail> {
    const agent = isAgent(actor);
    if (!agent && input.kind === 'internal') {
      throw forbidden('Só agentes escrevem notas internas.');
    }
    if (!agent && input.status !== undefined) {
      throw forbidden('Só agentes mudam o status do ticket.');
    }
    if (!UUID.test(id)) throw notFound();
    const bodyHtml = cleanBody(input.bodyHtml);
    this.attachments.validate(files);
    // Antes de gravar arquivos: quem não vê o ticket recebe 404 sem tocar no storage.
    if (files.length > 0 && !(await this.tickets.existsInScope(actor, id))) throw notFound();
    const stored = await this.attachments.storeAll(files);

    const emits = await this.withStoredFiles(stored, () =>
      this.tickets.transaction(async (tx) => {
        const ticket = await this.lockOrThrow(tx, actor, id);
        if (ticket.status === 'closed') throw ticketClosed();
        if (input.version !== undefined && input.version !== ticket.version) {
          throw versionConflict(ticket.version);
        }

        const authorIsRequester = actor.id === ticket.requesterId;
        const changes: TicketChanges = {};
        const pending: PendingEmit[] = [];
        let statusEvent: Omit<NewEvent, 'ticketId' | 'actorId' | 'ip'> | null = null;

        if (input.kind === 'public' && agent && !authorIsRequester && !ticket.firstResponseAt) {
          changes.firstResponseAt = new Date();
        }

        if (input.status !== undefined) {
          const plan = planStatusChange(ticket.status, input.status, ticket.companyId, new Date());
          if (plan) {
            Object.assign(changes, { status: plan.to }, plan.timestamps);
            statusEvent = fromTo('status_changed', plan.from, plan.to);
            pending.push(statusEmit(id, actor.id, plan.from, plan.to));
          }
        } else if (
          input.kind === 'public' &&
          authorIsRequester &&
          (ticket.status === 'pending' || ticket.status === 'resolved')
        ) {
          const plan = planStatusChange(ticket.status, 'open', ticket.companyId, new Date());
          if (plan) {
            Object.assign(changes, { status: plan.to }, plan.timestamps);
            statusEvent = {
              type: 'status_changed',
              data: { from: plan.from, to: plan.to, reason: 'requester_reply' },
            };
            pending.push(statusEmit(id, actor.id, plan.from, plan.to, 'requester_reply'));
          }
        }

        const message = await this.tickets.addMessage(tx, {
          ticketId: id,
          authorId: actor.id,
          kind: input.kind,
          via: 'portal',
          bodyHtml,
        });
        await this.attachments.createRecords(tx, message.id, stored);
        // Mudar o status muda o ticket: a versão sobe, para um PATCH concorrente dar 409.
        await this.tickets.update(tx, id, changes, changes.status !== undefined);
        await this.events.append(tx, {
          ticketId: id,
          actorId: actor.id,
          type: 'message_added',
          data: { messageId: message.id, kind: input.kind },
          ip,
        });
        if (statusEvent) {
          await this.events.append(tx, { ...statusEvent, ticketId: id, actorId: actor.id, ip });
        }
        // T14: nota interna nunca gera e-mail; resolver junto com a resposta sai num e-mail só.
        const resolved = changes.status === 'resolved';
        if (input.kind === 'public') {
          await this.notifications.enqueue(tx, {
            type: 'public_reply',
            ticket: notified(ticket),
            actorId: actor.id,
            message: { bodyHtml, attachments: stored },
            resolved,
          });
        } else if (resolved) {
          await this.notifications.enqueue(tx, {
            type: 'resolved',
            ticket: notified(ticket),
            actorId: actor.id,
          });
        }

        pending.unshift({
          name: TicketDomainEvent.messageAdded,
          payload: {
            ticketId: id,
            messageId: message.id,
            kind: input.kind,
            authorId: actor.id,
            authorIsRequester,
          } satisfies TicketMessageAddedEvent,
        });
        return pending;
      }),
    );

    this.emitAll(emits);
    return this.toDetail(await this.tickets.loadAfterWrite(actor, id));
  }

  /**
   * Anexo para download (T13): o ticket precisa estar no escopo e, para quem não é agente, a
   * mensagem precisa ser pública. Qualquer falha → 404.
   */
  async openAttachment(
    viewer: ScopeUser,
    id: string,
  ): Promise<{ attachment: AttachmentRecord; stream: Readable }> {
    if (!UUID.test(id)) throw attachmentNotFound();
    const attachment = await this.attachments.findById(id);
    if (!attachment || !(await this.tickets.messageVisibleTo(viewer, attachment.messageId))) {
      throw attachmentNotFound();
    }
    try {
      return { attachment, stream: await this.attachments.open(attachment.storageKey) };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        this.logger.error(`Anexo ${attachment.id} sem objeto no storage`);
        throw attachmentNotFound();
      }
      throw error;
    }
  }

  /** Se a gravação no banco falhar, os arquivos já gravados no storage são apagados. */
  private async withStoredFiles<T>(stored: StoredFile[], write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      await this.attachments.discard(stored);
      throw error;
    }
  }

  /** Detalhe com `refs`: nomes dos ids que os eventos citam, resolvidos na leitura. */
  private async toDetail(row: TicketDetailRow): Promise<TicketDetail> {
    const ids: Record<'users' | 'groups' | 'companies' | 'categories', Set<string>> = {
      users: new Set(),
      groups: new Set(),
      companies: new Set(),
      categories: new Set(),
    };
    for (const event of row.events) {
      const kind = REF_KIND[event.type];
      const data = event.data;
      if (!kind || !data || typeof data !== 'object' || Array.isArray(data)) continue;
      for (const value of [data.from, data.to]) {
        if (typeof value === 'string') ids[kind].add(value);
      }
    }
    const found = await Promise.all([
      this.users.namesByIds([...ids.users]),
      this.groups.namesByIds([...ids.groups]),
      this.companies.namesByIds([...ids.companies]),
      this.categories.namesByIds([...ids.categories]),
    ]);
    const refs = Object.fromEntries(found.flat().map((ref) => [ref.id, ref.name]));
    return toTicketDetail(row, refs);
  }

  private async lockOrThrow(tx: Tx, actor: ScopeUser, id: string): Promise<LockedTicket> {
    const ticket = await this.tickets.lockInScope(tx, actor, id);
    if (!ticket) throw notFound();
    return ticket;
  }

  /** RN-26: agente+ ativo e membro do grupo; supervisor e admin (ator ou atribuído) dispensam o grupo. */
  private async assertAssignable(actor: ScopeUser, assigneeId: string, groupId: string) {
    const user = await this.users.findById(assigneeId);
    if (!user || !user.active) throw notAssignable();
    const assignee = { roles: user.roles.filter(isKnownRole) };
    if (!isAgent(assignee)) throw notAssignable();
    if (seesAllTickets(actor) || seesAllTickets(assignee)) return;
    if (!(await this.groups.isMember(groupId, assigneeId))) throw notAssignable();
  }

  private emitAll(emits: PendingEmit[]): void {
    for (const { name, payload } of emits) this.emitter.emit(name, payload);
  }

  async detail(viewer: ScopeUser, id: string): Promise<TicketDetail> {
    if (!UUID.test(id)) throw notFound();
    const row = await this.tickets.findDetail(viewer, id);
    if (!row) throw notFound();
    return this.toDetail(row);
  }

  /** RN-04 a RN-11. */
  async create(
    actor: TicketActor,
    input: CreateTicketData,
    ip: string | null,
    files: readonly IncomingFile[] = [],
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
    const stored = await this.attachments.storeAll(files);

    const created = await this.withStoredFiles(stored, () =>
      this.tickets.transaction(async (tx) => {
        const ticket = await this.tickets.create(tx, {
          subject: input.subject,
          priority: input.priority,
          source,
          requesterId: requester.id,
          groupId: category.defaultGroup.id,
          categoryId: category.id,
          companyId,
        });
        const message = await this.tickets.addMessage(tx, {
          ticketId: ticket.id,
          authorId: actor.id,
          kind: 'public',
          via: 'portal',
          bodyHtml,
        });
        await this.attachments.createRecords(tx, message.id, stored);
        await this.events.append(tx, {
          ticketId: ticket.id,
          actorId: actor.id,
          type: 'created',
          data: input.relatedTicketId ? { relatedTicketId: input.relatedTicketId } : {},
          ip,
        });
        await this.notifications.enqueue(tx, {
          type: 'ticket_created',
          ticket: {
            id: ticket.id,
            number: ticket.number,
            subject: input.subject,
            requesterId: requester.id,
            assigneeId: null,
            groupId: category.defaultGroup.id,
            companyId,
            categoryId: category.id,
          },
          actorId: actor.id,
          message: { bodyHtml, attachments: stored },
        });
        return ticket;
      }),
    );

    this.emitter.emit(TicketDomainEvent.created, {
      ticketId: created.id,
      number: created.number,
      actorId: actor.id,
      requesterId: requester.id,
      source,
    } satisfies TicketCreatedEvent);

    return this.toDetail(await this.tickets.loadAfterWrite(actor, created.id));
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

/** O ticket para as notificações, com o que mudou nesta transação por cima. */
function notified(
  ticket: LockedTicket,
  overrides: Partial<
    Pick<NotifiedTicket, 'assigneeId' | 'groupId' | 'companyId' | 'categoryId'>
  > = {},
): NotifiedTicket {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    requesterId: ticket.requesterId,
    assigneeId: ticket.assigneeId,
    groupId: ticket.groupId,
    companyId: ticket.companyId,
    categoryId: ticket.categoryId,
    ...overrides,
  };
}

function isKnownRole(role: string): role is 'admin' | 'supervisor' | 'agente' {
  return role === 'admin' || role === 'supervisor' || role === 'agente';
}

function fromTo(
  type: string,
  from: string | null,
  to: string | null,
): Omit<NewEvent, 'ticketId' | 'actorId' | 'ip'> {
  return { type, data: { from, to } };
}

function statusEmit(
  ticketId: string,
  actorId: string,
  from: TicketStatus,
  to: TicketStatus,
  reason?: 'requester_reply',
): PendingEmit {
  return {
    name: TicketDomainEvent.statusChanged,
    payload: {
      ticketId,
      actorId,
      from,
      to,
      ...(reason ? { reason } : {}),
    } satisfies TicketStatusChangedEvent,
  };
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
