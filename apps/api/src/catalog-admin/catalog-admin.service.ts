import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiErrorCode,
  DEFAULT_CATEGORY_NAME,
  type CatalogItem,
  type CategoryItem,
  type CreateCatalogItemInput,
  type CreateCategoryInput,
  type CreateGroupInput,
  type GroupItem,
  type UpdateCatalogItemInput,
  type UpdateCategoryInput,
  type UpdateGroupInput,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { isUuid } from '../common/uuid.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { mailboxAddress } from '../notifications/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const itemSelect = { id: true, name: true, active: true } as const;
const groupSelect = { ...itemSelect, email: true, inboundEmail: true } as const;
const categorySelect = {
  ...itemSelect,
  defaultGroup: { select: { id: true, name: true, active: true } },
} as const;

type CategoryRow = Omit<CategoryItem, 'locked'>;

const toCategoryItem = (row: CategoryRow): CategoryItem => ({
  ...row,
  locked: row.name === DEFAULT_CATEGORY_NAME,
});

/** Mesmo nome, sem diferenciar maiúsculas; `exceptId` ignora o próprio registro na edição. */
const sameName = (name: string, exceptId?: string) => ({
  name: { equals: name, mode: 'insensitive' as const },
  ...(exceptId ? { id: { not: exceptId } } : {}),
});

const notFound = (label: string) =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, `${label} não encontrado(a).`);

const nameTaken = (label: string) =>
  new ApiException(
    HttpStatus.CONFLICT,
    ApiErrorCode.NAME_TAKEN,
    `Já existe ${label} com esse nome.`,
  );

/**
 * T25: cadastros de referência pela tela de admin. Não há exclusão: desativar tira o item das
 * listas de escolha (que só mostram os ativos) sem mexer em quem já o usa.
 */
@Injectable()
export class CatalogAdminService {
  private readonly ownAddress: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ownAddress = mailboxAddress(config.get('MAIL_FROM', { infer: true }));
  }

  // ───────────── unidades ─────────────

  listCompanies(): Promise<CatalogItem[]> {
    return this.prisma.company.findMany({ select: itemSelect, orderBy: { name: 'asc' } });
  }

  async createCompany(input: CreateCatalogItemInput): Promise<CatalogItem> {
    await this.assertNameFree(
      'uma unidade',
      this.prisma.company.findFirst({ where: sameName(input.name), select: { id: true } }),
    );
    return this.uniqueName('uma unidade', () =>
      this.prisma.company.create({ data: input, select: itemSelect }),
    );
  }

  async updateCompany(id: string, input: UpdateCatalogItemInput): Promise<CatalogItem> {
    const found = isUuid(id) && (await this.prisma.company.findUnique({ where: { id } }));
    if (!found) throw notFound('Unidade');
    if (input.name) {
      await this.assertNameFree(
        'uma unidade',
        this.prisma.company.findFirst({ where: sameName(input.name, id), select: { id: true } }),
      );
    }
    return this.uniqueName('uma unidade', () =>
      this.prisma.company.update({ where: { id }, data: input, select: itemSelect }),
    );
  }

  // ───────────── departamentos ─────────────

  listDepartments(): Promise<CatalogItem[]> {
    return this.prisma.department.findMany({ select: itemSelect, orderBy: { name: 'asc' } });
  }

  async createDepartment(input: CreateCatalogItemInput): Promise<CatalogItem> {
    await this.assertNameFree(
      'um departamento',
      this.prisma.department.findFirst({ where: sameName(input.name), select: { id: true } }),
    );
    return this.uniqueName('um departamento', () =>
      this.prisma.department.create({ data: input, select: itemSelect }),
    );
  }

  async updateDepartment(id: string, input: UpdateCatalogItemInput): Promise<CatalogItem> {
    const found = isUuid(id) && (await this.prisma.department.findUnique({ where: { id } }));
    if (!found) throw notFound('Departamento');
    if (input.name) {
      await this.assertNameFree(
        'um departamento',
        this.prisma.department.findFirst({ where: sameName(input.name, id), select: { id: true } }),
      );
    }
    return this.uniqueName('um departamento', () =>
      this.prisma.department.update({ where: { id }, data: input, select: itemSelect }),
    );
  }

  // ───────────── grupos ─────────────

  listGroups(): Promise<GroupItem[]> {
    return this.prisma.group.findMany({ select: groupSelect, orderBy: { name: 'asc' } });
  }

  async createGroup(input: CreateGroupInput): Promise<GroupItem> {
    await this.assertNameFree(
      'um grupo',
      this.prisma.group.findFirst({ where: sameName(input.name), select: { id: true } }),
    );
    await this.assertInboundFree(input.inboundEmail);
    return this.uniqueName('um grupo', () =>
      this.prisma.group.create({ data: input, select: groupSelect }),
    );
  }

  /** Grupo padrão de categoria ativa não se desativa: os tickets novos dela ficariam sem fila. */
  async updateGroup(id: string, input: UpdateGroupInput): Promise<GroupItem> {
    const found = isUuid(id) && (await this.prisma.group.findUnique({ where: { id } }));
    if (!found) throw notFound('Grupo');
    if (input.name) {
      await this.assertNameFree(
        'um grupo',
        this.prisma.group.findFirst({ where: sameName(input.name, id), select: { id: true } }),
      );
    }
    await this.assertInboundFree(input.inboundEmail, id);
    if (input.active === false && found.active) {
      const categories = await this.prisma.category.findMany({
        where: { defaultGroupId: id, active: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      if (categories.length > 0) {
        const names = categories.map((category) => category.name);
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ApiErrorCode.GROUP_IN_USE,
          `O grupo é o padrão de categorias ativas (${names.join(', ')}). Troque o grupo padrão ` +
            'delas ou desative-as antes.',
          { categories: names },
        );
      }
    }
    return this.uniqueName('um grupo', () =>
      this.prisma.group.update({ where: { id }, data: input, select: groupSelect }),
    );
  }

  // ───────────── categorias ─────────────

  async listCategories(): Promise<CategoryItem[]> {
    const rows = await this.prisma.category.findMany({
      select: categorySelect,
      orderBy: { name: 'asc' },
    });
    return rows.map(toCategoryItem);
  }

  async createCategory(input: CreateCategoryInput): Promise<CategoryItem> {
    await this.assertActiveGroup(input.defaultGroupId);
    await this.assertNameFree(
      'uma categoria',
      this.prisma.category.findFirst({ where: sameName(input.name), select: { id: true } }),
    );
    const row = await this.uniqueName('uma categoria', () =>
      this.prisma.category.create({ data: input, select: categorySelect }),
    );
    return toCategoryItem(row);
  }

  /** A categoria padrão do e-mail (T21) só pode trocar de grupo padrão. */
  async updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryItem> {
    const found = isUuid(id) && (await this.prisma.category.findUnique({ where: { id } }));
    if (!found) throw notFound('Categoria');
    if (
      found.name === DEFAULT_CATEGORY_NAME &&
      ((input.name !== undefined && input.name !== found.name) || input.active === false)
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.PROTECTED_ITEM,
        `A categoria "${DEFAULT_CATEGORY_NAME}" recebe os tickets abertos por e-mail: não pode ser ` +
          'renomeada nem desativada. Só o grupo padrão dela pode mudar.',
      );
    }
    if (input.defaultGroupId) await this.assertActiveGroup(input.defaultGroupId);
    if (input.name) {
      await this.assertNameFree(
        'uma categoria',
        this.prisma.category.findFirst({ where: sameName(input.name, id), select: { id: true } }),
      );
    }
    const row = await this.uniqueName('uma categoria', () =>
      this.prisma.category.update({ where: { id }, data: input, select: categorySelect }),
    );
    return toCategoryItem(row);
  }

  // ───────────── apoio ─────────────

  private async assertActiveGroup(groupId: string): Promise<void> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, active: true },
      select: { id: true },
    });
    if (!group) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.INACTIVE_REFERENCE,
        'O grupo padrão precisa existir e estar ativo.',
      );
    }
  }

  /**
   * #42: a caixa de entrada é de um grupo só, e não pode ser a do próprio help desk (todo e-mail
   * iria para o grupo, no lugar do padrão da categoria "Geral").
   */
  private async assertInboundFree(inboundEmail: string | null | undefined, exceptId?: string) {
    if (!inboundEmail) return;
    if (inboundEmail.toLowerCase() === this.ownAddress) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.INBOUND_EMAIL_TAKEN,
        'Essa é a caixa do próprio help desk: os e-mails dela já vão para o grupo padrão da categoria "Geral".',
      );
    }
    const other = await this.prisma.group.findFirst({
      where: { inboundEmail, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true },
    });
    if (other) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ApiErrorCode.INBOUND_EMAIL_TAKEN,
        `Essa caixa de entrada já é do grupo ${other.name}.`,
      );
    }
  }

  private async assertNameFree(label: string, existing: Promise<{ id: string } | null>) {
    if (await existing) throw nameTaken(label);
  }

  /** A checagem acima não fecha a corrida entre dois cadastros iguais; o índice único fecha. */
  private async uniqueName<T>(label: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw nameTaken(label);
      }
      throw error;
    }
  }
}
