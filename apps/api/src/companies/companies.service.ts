import { Injectable } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { PrismaService } from '../prisma/prisma.service.js';

// Unidades (escolas/obras).
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  listActive(): Promise<NamedRef[]> {
    return this.prisma.company.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Nomes por id (para o histórico do ticket); ids desconhecidos ficam de fora. */
  namesByIds(ids: readonly string[]): Promise<NamedRef[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.company.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }

  async isActive(id: string): Promise<boolean> {
    const found = await this.prisma.company.findFirst({
      where: { id, active: true },
      select: { id: true },
    });
    return found !== null;
  }
}
