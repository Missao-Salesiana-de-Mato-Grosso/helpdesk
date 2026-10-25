import { Injectable } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const members = await this.prisma.groupMember.findMany({
      where: {
        groupId,
        user: { active: true, roles: { hasSome: ['agente', 'supervisor', 'admin'] } },
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
