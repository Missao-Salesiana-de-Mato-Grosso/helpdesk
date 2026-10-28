import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiErrorCode,
  ROLES,
  type AccessRequestListResponse,
  type AccessRequestSummary,
  type ListAccessRequestsQuery,
  type ListUsersQuery,
  type NamedRef,
  type Role,
  type UpdateUserInput,
  type UserListResponse,
  type UserSummary,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { isUuid } from '../common/uuid.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { Env } from '../config/env.js';
import { DepartmentsService } from '../departments/departments.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { systemEmailMessageId, systemNotificationPayload } from '../notifications/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const userWithGroupIds = {
  include: { groupMemberships: { select: { groupId: true } } },
} satisfies Prisma.UserDefaultArgs;

export type UserWithGroupIds = Prisma.UserGetPayload<typeof userWithGroupIds>;

const userProfile = {
  include: {
    company: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    groupMemberships: {
      where: { group: { active: true } },
      select: { group: { select: { id: true, name: true } } },
      orderBy: { group: { name: 'asc' } },
    },
  },
} satisfies Prisma.UserDefaultArgs;

export type UserProfile = Prisma.UserGetPayload<typeof userProfile>;

const userSummary = {
  select: {
    id: true,
    name: true,
    email: true,
    roles: true,
    isExternal: true,
    active: true,
    accessStatus: true,
    lastLoginAt: true,
    zitadelSub: true,
    company: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    groupMemberships: {
      where: { group: { active: true } },
      select: { group: { select: { id: true, name: true } } },
      orderBy: { group: { name: 'asc' } },
    },
  },
} satisfies Prisma.UserDefaultArgs;

type UserSummaryRow = Prisma.UserGetPayload<typeof userSummary>;

/** Papéis de atendimento: quem pode ser membro de grupo e receber tickets. */
export const AGENT_ROLES: readonly Role[] = ['agente', 'supervisor', 'admin'];

export const isAgentRole = (role: string): boolean =>
  (AGENT_ROLES as readonly string[]).includes(role);

const isRole = (role: string): role is Role => (ROLES as readonly string[]).includes(role);

function toUserSummary(row: UserSummaryRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles.filter(isRole),
    company: row.company,
    department: row.department,
    groups: row.groupMemberships.map((membership) => membership.group),
    isExternal: row.isExternal,
    active: row.active,
    accessStatus: row.accessStatus,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

const userNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Usuário não encontrado.');
const inactiveReference = (message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.INACTIVE_REFERENCE, message);

export interface MembershipCandidate {
  id: string;
  active: boolean;
  roles: string[];
}

export interface UserContact {
  id: string;
  name: string;
  email: string;
  active: boolean;
  isExternal: boolean;
}

export interface NewLoginUser {
  zitadelSub: string;
  email: string;
  name: string;
  roles: string[];
}

/** Acesso à tabela `users`. Outros módulos passam por aqui, nunca pelo Prisma diretamente. */
@Injectable()
export class UsersService {
  private readonly portalUrl: string;
  private readonly messageIdDomain: string;
  private readonly internalDomains: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly departments: DepartmentsService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('PORTAL_URL', { infer: true });
    this.messageIdDomain = config.get('MAIL_MESSAGE_ID_DOMAIN', { infer: true });
    this.internalDomains = config.get('INTERNAL_EMAIL_DOMAINS', { infer: true });
  }

  /** Nomes por id (para o histórico do ticket); ids desconhecidos ficam de fora. */
  namesByIds(ids: readonly string[]): Promise<NamedRef[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }

  /** Dados de contato para as notificações (T14). */
  contactsByIds(ids: readonly string[]): Promise<UserContact[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, email: true, active: true, isExternal: true },
    });
  }

  findById(id: string): Promise<UserWithGroupIds | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userWithGroupIds });
  }

  findBySub(zitadelSub: string): Promise<UserWithGroupIds | null> {
    return this.prisma.user.findUnique({ where: { zitadelSub }, ...userWithGroupIds });
  }

  /** `email` é citext: a comparação já é case-insensitive. */
  findByEmail(email: string): Promise<UserWithGroupIds | null> {
    return this.prisma.user.findUnique({ where: { email }, ...userWithGroupIds });
  }

  /**
   * Remetente de e-mail (T21 RN-10): o usuário com esse e-mail ou um novo, sem login. Terceiro
   * (`is_external`) quando o domínio não é institucional. Dois e-mails simultâneos do mesmo
   * desconhecido: o segundo encontra o criado pelo primeiro.
   */
  async findOrCreateFromEmail(data: {
    email: string;
    name: string;
    isExternal: boolean;
  }): Promise<UserWithGroupIds> {
    const existing = await this.findByEmail(data.email);
    if (existing) return existing;
    try {
      return await this.prisma.user.create({ data, ...userWithGroupIds });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const created = await this.findByEmail(data.email);
        if (created) return created;
      }
      throw error;
    }
  }

  createFromLogin(data: NewLoginUser, now: Date): Promise<UserWithGroupIds> {
    return this.prisma.user.create({
      data: { ...data, lastLoginAt: now, profileSyncedAt: now },
      ...userWithGroupIds,
    });
  }

  /** Vincula ao login um usuário criado pelo canal de e-mail (RN-10.2). */
  linkToLogin(id: string, data: NewLoginUser, now: Date): Promise<UserWithGroupIds> {
    return this.prisma.user.update({
      where: { id },
      data: {
        zitadelSub: data.zitadelSub,
        name: data.name,
        roles: data.roles,
        lastLoginAt: now,
        profileSyncedAt: now,
      },
      ...userWithGroupIds,
    });
  }

  updateLoginState(
    id: string,
    data: Pick<
      Prisma.UserUpdateInput,
      'roles' | 'lastLoginAt' | 'profileSyncedAt' | 'name' | 'email'
    >,
  ): Promise<UserWithGroupIds> {
    return this.prisma.user.update({ where: { id }, data, ...userWithGroupIds });
  }

  findProfile(id: string): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userProfile });
  }

  /** Grava a unidade no usuário (triagem de ticket, RN-28 da spec T08–T10). */
  async setCompany(
    id: string,
    companyId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.user.update({ where: { id }, data: { companyId } });
  }

  /** Tela de 1º acesso. Na 1ª vez com os dois campos preenchidos, entra na fila (T22 RN-16). */
  setCompanyAndDepartment(
    id: string,
    companyId: string,
    departmentId: string,
  ): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { accessRequestedAt: true },
      });
      const enteredQueue = current.accessRequestedAt === null;
      const profile = await tx.user.update({
        where: { id },
        data: {
          companyId,
          departmentId,
          ...(enteredQueue ? { accessRequestedAt: new Date() } : {}),
        },
        ...userProfile,
      });
      if (enteredQueue) {
        const admins = await this.listActiveAdminsAndSupervisors(tx);
        await this.enqueueSystemEmail(tx, admins, 'access_request_created', {
          requesterName: profile.name,
          requesterEmail: profile.email,
        });
      }
      return profile;
    });
  }

  // ───────────────────────────── administração (T15) ─────────────────────────────

  /** Busca por nome ou e-mail, em ordem alfabética. A lixeira da T22 tem tela própria. */
  async listUsers(query: ListUsersQuery): Promise<UserListResponse> {
    const filters: Prisma.UserWhereInput[] = [{ accessStatus: { not: 'trashed' } }];
    if (query.q) {
      filters.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.role === 'agent') filters.push({ roles: { hasSome: [...AGENT_ROLES] } });
    const where: Prisma.UserWhereInput = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        ...userSummary,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(toUserSummary), total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Unidade, departamento, terceiro e `active`. Papéis vêm do Zitadel e não se editam aqui.
   * Devolve também o `sub`, para o controller invalidar o cache (o efeito é imediato).
   */
  async updateByAdmin(
    id: string,
    input: UpdateUserInput,
    actorId: string,
  ): Promise<{ user: UserSummary; zitadelSub: string | null }> {
    if (!isUuid(id)) throw userNotFound();
    if (input.active === false && id === actorId) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.CANNOT_DEACTIVATE_SELF,
        'Você não pode inativar a própria conta.',
      );
    }
    if (input.companyId && !(await this.companies.isActive(input.companyId))) {
      throw inactiveReference('Unidade inexistente ou inativa.');
    }
    if (input.departmentId && !(await this.departments.isActive(input.departmentId))) {
      throw inactiveReference('Departamento inexistente ou inativo.');
    }
    const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw userNotFound();
    const row = await this.prisma.user.update({ where: { id }, data: input, ...userSummary });
    return { user: toUserSummary(row), zitadelSub: row.zitadelSub };
  }

  /** Para validar a troca de membros de um grupo (T15). Ids desconhecidos ficam de fora. */
  membershipCandidates(ids: readonly string[]): Promise<MembershipCandidate[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, active: true, roles: true },
    });
  }

  /** `sub` de quem já fez login, para invalidar o cache depois de uma mudança de grupo. */
  async subsByIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...ids] }, zitadelSub: { not: null } },
      select: { zitadelSub: true },
    });
    return rows.flatMap((row) => (row.zitadelSub ? [row.zitadelSub] : []));
  }

  // ───────────────────────────── liberação de acesso (T22) ─────────────────────────────

  /** T22 RN-04: quem ganhou role no Zitadel está liberado, aprovado ou não. Sem e-mail (já sabe). */
  async autoApproveByRole(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.user.update({
      where: { id },
      data: {
        accessStatus: 'approved',
        accessDecidedAt: new Date(),
        accessDecidedById: null,
        trashedAt: null,
      },
    });
  }

  /** T22 RN-10: fila de liberação (`pending`) ou lixeira (`trashed`), do mais antigo ao mais novo. */
  async listAccessRequests(query: ListAccessRequestsQuery): Promise<AccessRequestListResponse> {
    const where: Prisma.UserWhereInput = { accessStatus: query.status };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { accessRequestedAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          accessStatus: true,
          accessRequestedAt: true,
          company: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const items: AccessRequestSummary[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      company: row.company,
      department: row.department,
      isExternalDomain: !this.internalDomains.some((domain) =>
        row.email.toLowerCase().endsWith(`@${domain}`),
      ),
      accessStatus: row.accessStatus,
      accessRequestedAt: (row.accessRequestedAt ?? new Date(0)).toISOString(),
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** T22 RN-11: confirma ou troca unidade/departamento sugeridos; invalida o cache (RN-15). */
  async approveAccess(
    id: string,
    data: { companyId: string; departmentId: string; isExternal?: boolean },
    decidedById: string,
  ): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { accessStatus: true } });
      if (!current) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          ApiErrorCode.NOT_FOUND,
          'Usuário não encontrado.',
        );
      }
      if (current.accessStatus === 'approved') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.ACCESS_ALREADY_DECIDED,
          'Usuário já está liberado.',
        );
      }
      const profile = await tx.user.update({
        where: { id },
        data: {
          companyId: data.companyId,
          departmentId: data.departmentId,
          ...(data.isExternal !== undefined ? { isExternal: data.isExternal } : {}),
          accessStatus: 'approved',
          accessDecidedAt: new Date(),
          accessDecidedById: decidedById,
          trashedAt: null,
        },
        ...userProfile,
      });
      // RN-17/18: só a liberação avisa o usuário; a recusa não (RN-12).
      await this.enqueueSystemEmail(
        tx,
        [{ email: profile.email, name: profile.name }],
        'access_granted',
      );
      return profile;
    });
  }

  /** T22 RN-12: nota interna, nunca exposta ao usuário. Sem e-mail. */
  async rejectAccess(
    id: string,
    data: { note?: string },
    decidedById: string,
  ): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { accessStatus: true } });
      if (!current) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          ApiErrorCode.NOT_FOUND,
          'Usuário não encontrado.',
        );
      }
      if (current.accessStatus === 'rejected') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.ACCESS_ALREADY_DECIDED,
          'Usuário já foi recusado.',
        );
      }
      return tx.user.update({
        where: { id },
        data: {
          accessStatus: 'rejected',
          accessDecidedAt: new Date(),
          accessDecidedById: decidedById,
          accessNote: data.note ?? null,
          trashedAt: null,
        },
        ...userProfile,
      });
    });
  }

  /**
   * T22 RN-19a: tira da lixeira, volta para `pending` com novo `accessRequestedAt` e avisa os
   * admins de novo — seja por ação do admin (restaurar) ou pelo próprio login da pessoa.
   */
  async restoreAccess(id: string): Promise<UserProfile> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { accessStatus: true } });
      if (!current) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          ApiErrorCode.NOT_FOUND,
          'Usuário não encontrado.',
        );
      }
      if (current.accessStatus !== 'trashed') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.ACCESS_ALREADY_DECIDED,
          'Usuário não está na lixeira.',
        );
      }
      const profile = await tx.user.update({
        where: { id },
        data: { accessStatus: 'pending', trashedAt: null, accessRequestedAt: new Date() },
        ...userProfile,
      });
      const admins = await this.listActiveAdminsAndSupervisors(tx);
      await this.enqueueSystemEmail(tx, admins, 'access_request_created', {
        requesterName: profile.name,
        requesterEmail: profile.email,
      });
      return profile;
    });
  }

  /** T22 RN-19c/19d: exclusão definitiva de um item da lixeira. Pula quem já ganhou ticket. */
  async deleteTrashedAccess(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { accessStatus: true } });
      if (!current || current.accessStatus !== 'trashed') {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          ApiErrorCode.NOT_FOUND,
          'Pedido não está na lixeira.',
        );
      }
      const withTicket = await this.withAnyTicket(tx, [id]);
      if (withTicket.has(id)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.ACCESS_HAS_TICKET,
          'Usuário já tem ticket; não pode ser excluído.',
        );
      }
      await tx.user.delete({ where: { id } });
    });
  }

  /**
   * T22 RN-19c/19d: esvazia a lixeira inteira. Quem ganhou ticket entretanto volta para `pending`
   * em vez de ser excluído, e é contado em `skipped`.
   */
  async emptyTrash(): Promise<{ deleted: number; skipped: number }> {
    return this.prisma.$transaction(async (tx) => {
      const trashed = await tx.user.findMany({
        where: { accessStatus: 'trashed' },
        select: { id: true },
      });
      const ids = trashed.map((row) => row.id);
      const withTicket = await this.withAnyTicket(tx, ids);
      const deleteIds = ids.filter((id) => !withTicket.has(id));
      if (withTicket.size > 0) {
        await tx.user.updateMany({
          where: { id: { in: [...withTicket] } },
          data: { accessStatus: 'pending', trashedAt: null },
        });
      }
      if (deleteIds.length > 0) {
        await tx.user.deleteMany({ where: { id: { in: deleteIds } } });
      }
      return { deleted: deleteIds.length, skipped: withTicket.size };
    });
  }

  /**
   * T22 RN-19: cron diário (ver `access-requests.cron.ts`). `pending` sem decisão há mais de
   * `cutoffDays` vai para a lixeira — exceto quem já tem ticket (RN-19b).
   */
  async trashExpiredPendingRequests(cutoffDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.user.findMany({
        where: { accessStatus: 'pending', accessRequestedAt: { lt: cutoff } },
        select: { id: true },
      });
      const candidateIds = candidates.map((row) => row.id);
      const withTicket = await this.withAnyTicket(tx, candidateIds);
      const ids = candidateIds.filter((id) => !withTicket.has(id));
      if (ids.length === 0) return 0;
      await tx.user.updateMany({
        where: { id: { in: ids } },
        data: { accessStatus: 'trashed', trashedAt: new Date() },
      });
      return ids.length;
    });
  }

  /** Quem, entre `ids`, já é solicitante ou responsável de algum ticket (RN-19b, RN-19d). */
  private async withAnyTicket(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const tickets = await tx.ticket.findMany({
      where: { OR: [{ requesterId: { in: [...ids] } }, { assigneeId: { in: [...ids] } }] },
      select: { requesterId: true, assigneeId: true },
    });
    const found = new Set<string>();
    for (const ticket of tickets) {
      if (ids.includes(ticket.requesterId)) found.add(ticket.requesterId);
      if (ticket.assigneeId && ids.includes(ticket.assigneeId)) found.add(ticket.assigneeId);
    }
    return found;
  }

  private listActiveAdminsAndSupervisors(
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ email: string; name: string }[]> {
    return tx.user.findMany({
      where: { active: true, roles: { hasSome: ['admin', 'supervisor'] } },
      select: { email: true, name: true },
    });
  }

  /**
   * T22 RN-16 a RN-18: grava a linha na outbox direto, sem depender do `NotificationService`
   * (que já depende deste módulo para `contactsByIds`/`namesByIds` — ciclo evitado de propósito).
   * Só o `processOutbox` (`NotificationService`) sabe entregar; aqui só produz.
   */
  private async enqueueSystemEmail(
    tx: Prisma.TransactionClient,
    recipients: readonly { email: string; name: string }[],
    template: 'access_request_created' | 'access_granted',
    data: { requesterName?: string; requesterEmail?: string } = {},
  ): Promise<void> {
    if (recipients.length === 0) return;
    await tx.notification.createMany({
      data: recipients.map((to) => ({
        toEmail: to.email,
        template,
        payload: systemNotificationPayload(to.name, this.portalUrl, data),
        emailMessageId: systemEmailMessageId(this.messageIdDomain),
      })),
    });
  }
}
