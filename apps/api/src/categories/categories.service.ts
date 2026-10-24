import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ActiveCategory {
  id: string;
  name: string;
  defaultGroup: { id: string; name: string; active: boolean };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

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
