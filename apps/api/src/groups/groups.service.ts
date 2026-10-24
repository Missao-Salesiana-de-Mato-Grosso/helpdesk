import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

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
