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

  async isActive(id: string): Promise<boolean> {
    const found = await this.prisma.company.findFirst({
      where: { id, active: true },
      select: { id: true },
    });
    return found !== null;
  }
}
