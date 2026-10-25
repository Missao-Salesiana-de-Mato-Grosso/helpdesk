import { Injectable } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ActiveCategory {
  id: string;
  name: string;
  defaultGroup: { id: string; name: string; active: boolean };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Categorias que aceitam ticket novo: ativas e com o grupo padrão ativo (mesma regra do POST /tickets). */
  listActive(): Promise<NamedRef[]> {
    return this.prisma.category.findMany({
      where: { active: true, defaultGroup: { active: true } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Categoria ativa com o grupo padrão (que também precisa estar ativo para receber tickets). */
  findActive(id: string): Promise<ActiveCategory | null> {
    return this.prisma.category.findFirst({
      where: { id, active: true },
      select: {
        id: true,
        name: true,
        defaultGroup: { select: { id: true, name: true, active: true } },
      },
    });
  }
}
