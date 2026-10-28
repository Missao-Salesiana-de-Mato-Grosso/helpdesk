import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiErrorCode, type NamedRef } from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AGENT_ROLES, isAgentRole, UsersService } from '../users/users.service.js';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  listActive(): Promise<NamedRef[]> {
    return this.prisma.group.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Agentes ativos do grupo (para atribuição); `null` se o grupo não existe. */
  async listAssignableMembers(groupId: string): Promise<NamedRef[] | null> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!group) return null;
    return this.activeAgents(groupId);
  }

  /**
   * T15: a lista enviada passa a ser a lista de membros. Só usuários ativos com papel de
   * atendimento; membros inativos que já estavam no grupo saem. `null` se o grupo não existe.
   */
  async replaceMembers(
    groupId: string,
    userIds: readonly string[],
  ): Promise<{ members: NamedRef[]; affectedSubs: string[] } | null> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!group) return null;

    const wanted = [...new Set(userIds)];
    const candidates = new Map(
      (await this.users.membershipCandidates(wanted)).map((user) => [user.id, user]),
    );
    const invalid = wanted.filter((id) => {
      const user = candidates.get(id);
      return !user?.active || !user.roles.some(isAgentRole);
    });
    if (invalid.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.NOT_AN_AGENT,
        'Só agentes ativos podem ser membros de um grupo.',
        { userIds: invalid },
      );
    }

    const affected = await this.prisma.$transaction(async (tx) => {
      const current = (
        await tx.groupMember.findMany({ where: { groupId }, select: { userId: true } })
      ).map((member) => member.userId);
      const toRemove = current.filter((id) => !wanted.includes(id));
      const toAdd = wanted.filter((id) => !current.includes(id));
      if (toRemove.length > 0) {
        await tx.groupMember.deleteMany({ where: { groupId, userId: { in: toRemove } } });
      }
      if (toAdd.length > 0) {
        await tx.groupMember.createMany({ data: toAdd.map((userId) => ({ groupId, userId })) });
      }
      return [...toRemove, ...toAdd];
    });

    return {
      members: await this.activeAgents(groupId),
      affectedSubs: await this.users.subsByIds(affected),
    };
  }

  /** Para quem vai o aviso ao grupo (T14): o e-mail do grupo, se houver, e os agentes ativos. */
  async notificationTarget(
    groupId: string,
  ): Promise<{ name: string; email: string | null; memberIds: string[] } | null> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { name: true, email: true },
    });
    if (!group) return null;
    const members = await this.activeAgents(groupId);
    return { ...group, memberIds: members.map((member) => member.id) };
  }

  private async activeAgents(groupId: string): Promise<NamedRef[]> {
    const members = await this.prisma.groupMember.findMany({
      where: {
        groupId,
        user: { active: true, roles: { hasSome: [...AGENT_ROLES] } },
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return members.map((member) => member.user);
  }

  /** Nomes por id (para o histórico do ticket); ids desconhecidos ficam de fora. */
  namesByIds(ids: readonly string[]): Promise<NamedRef[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.group.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }

  async isActive(id: string): Promise<boolean> {
    const found = await this.prisma.group.findFirst({
      where: { id, active: true },
      select: { id: true },
    });
    return found !== null;
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const found = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { userId: true },
    });
    return found !== null;
  }
}
