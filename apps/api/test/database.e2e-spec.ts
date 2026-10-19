import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SEED, SYSTEM_USER_EMAIL, seed } from '../prisma/seed.js';
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
