// T11: lista de categorias do formulário de novo ticket.
import type { NamedRef } from '@helpdesk/shared';
import request from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

describe('GET /api/categories (e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    f = await createTicketsFixture(t);
  });

  const names = async () => {
    const res = await request(t.app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', `Bearer ${await f.token('req1')}`)
      .expect(200);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (res.body as NamedRef[]).map((category) => category.name);
  };

  it('lista as ativas em ordem alfabética', async () => {
    expect(await names()).toEqual(['Categoria 1', 'Categoria 2']);
  });

  it('omite categoria inativa e categoria cujo grupo padrão está inativo', async () => {
    await t.prisma.category.update({ where: { id: f.C1 }, data: { active: false } });
    await t.prisma.category.create({ data: { name: 'Categoria 3', defaultGroupId: f.G2 } });
    await t.prisma.group.update({ where: { id: f.G2 }, data: { active: false } });
    expect(await names()).toEqual([]);
  });
});
