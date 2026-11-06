import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DEFAULT_CATEGORY_NAME } from '@helpdesk/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEFAULT_CATEGORY, SEED, SYSTEM_USER_EMAIL, seed } from '../prisma/seed.js';
import { truncateAll } from './setup/db.js';

describe('schema, migração e seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('seed cria os dados de referência e é idempotente', async () => {
    await seed(prisma);
    await seed(prisma);

    expect(await prisma.department.count()).toBe(SEED.departments.length);
    expect(await prisma.company.count()).toBe(SEED.companies.length);
    expect(await prisma.group.count()).toBe(SEED.groups.length);
    expect(await prisma.category.count()).toBe(SEED.categories.length);

    const geral = await prisma.category.findUniqueOrThrow({
      where: { name: 'Geral' },
      include: { defaultGroup: true },
    });
    expect(geral.defaultGroup.name).toBe('Suporte TI');

    const system = await prisma.user.findUniqueOrThrow({ where: { email: SYSTEM_USER_EMAIL } });
    expect(system.active).toBe(false);
  });

  it('T25: não desfaz o que o admin mudou depois (renomear, trocar e-mail do grupo)', async () => {
    await seed(prisma);
    await prisma.company.update({
      where: { name: 'Unidade de exemplo' },
      data: { name: 'Escola Real' },
    });
    await prisma.group.update({ where: { name: 'Suporte TI' }, data: { email: null } });
    await prisma.department.update({ where: { name: 'Financeiro' }, data: { active: false } });

    await seed(prisma);

    expect(await prisma.company.findUnique({ where: { name: 'Unidade de exemplo' } })).toBeNull();
    expect(await prisma.company.count()).toBe(SEED.companies.length);
    const group = await prisma.group.findUniqueOrThrow({ where: { name: 'Suporte TI' } });
    expect(group.email).toBeNull();
    const department = await prisma.department.findUniqueOrThrow({ where: { name: 'Financeiro' } });
    expect(department.active).toBe(false);
  });

  it('T25: garante a categoria "Geral" mesmo com categorias já cadastradas', async () => {
    expect(DEFAULT_CATEGORY).toBe(DEFAULT_CATEGORY_NAME);
    const older = await prisma.group.create({ data: { name: 'Antigo', active: false } });
    const group = await prisma.group.create({ data: { name: 'Atendimento' } });
    await prisma.category.create({ data: { name: 'Rede', defaultGroupId: older.id } });

    await seed(prisma);

    const geral = await prisma.category.findUniqueOrThrow({ where: { name: DEFAULT_CATEGORY } });
    expect(geral.defaultGroupId).toBe(group.id);
    expect(await prisma.category.count()).toBe(2);
    expect(await prisma.group.count()).toBe(2);
  });

  it('e-mail é case-insensitive (citext) e único', async () => {
    await prisma.user.create({ data: { email: 'Maria@MissaoSalesiana.org.br', name: 'Maria' } });

    const found = await prisma.user.findUnique({
      where: { email: 'maria@missaosalesiana.org.br' },
    });
    expect(found?.name).toBe('Maria');

    await expect(
      prisma.user.create({ data: { email: 'MARIA@missaosalesiana.org.br', name: 'Outra' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('o número do ticket começa em 1001 e é sequencial', async () => {
    await seed(prisma);
    const requester = await prisma.user.findUniqueOrThrow({ where: { email: SYSTEM_USER_EMAIL } });
    const category = await prisma.category.findUniqueOrThrow({ where: { name: 'Geral' } });

    const create = (subject: string) =>
      prisma.ticket.create({
        data: {
          subject,
          source: 'portal',
          requesterId: requester.id,
          groupId: category.defaultGroupId,
          categoryId: category.id,
        },
      });

    const first = await create('Primeiro');
    const second = await create('Segundo');

    expect(first.number).toBe(1001);
    expect(second.number).toBe(1002);
    expect(first.status).toBe('open');
    expect(first.priority).toBe('medium');
    expect(first.version).toBe(1);
  });
});
