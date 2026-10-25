// T12: grupos e membros para o painel do agente; nomes do histórico (`refs`) no detalhe.
import type { NamedRef, TicketDetail } from '@helpdesk/shared';
import request from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const names = (body: unknown) => (body as NamedRef[]).map((ref) => ref.name);

describe('grupos e refs do histórico (e2e)', () => {
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

  const get = async (path: string, user: 'ag1' | 'req1' = 'ag1') =>
    request(t.app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${await f.token(user)}`);

  it('GET /api/groups lista os ativos em ordem alfabética', async () => {
    await t.prisma.group.update({ where: { id: f.G2 }, data: { active: false } });
    const res = await get('/api/groups');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['Grupo 1']);
  });

  it('GET /api/groups/:id/members: só agentes ativos do grupo; grupo inexistente → 404', async () => {
    await t.prisma.groupMember.createMany({
      data: [
        { groupId: f.G1, userId: f.users.sup },
        { groupId: f.G1, userId: f.users.req1 },
        { groupId: f.G1, userId: f.users.adm },
      ],
    });
    await t.prisma.user.update({ where: { id: f.users.adm }, data: { active: false } });
    expect(names((await get(`/api/groups/${f.G1}/members`)).body)).toEqual(['ag1', 'sup']);
    expect((await get('/api/groups/00000000-0000-4000-8000-000000000000/members')).status).toBe(
      404,
    );
    expect((await get('/api/groups/abc/members')).status).toBe(404);
  });

  it('o detalhe traz em refs os nomes dos ids citados nos eventos', async () => {
    const ticket = await f.ticket({ requester: 'req1', group: 'G1', company: null });
    await t.prisma.ticketEvent.createMany({
      data: [
        {
          ticketId: ticket.id,
          actorId: f.users.ag1,
          type: 'assigned',
          data: { from: null, to: f.users.ag1 },
        },
        {
          ticketId: ticket.id,
          actorId: f.users.ag1,
          type: 'group_changed',
          data: { from: f.G1, to: f.G2 },
        },
        {
          ticketId: ticket.id,
          actorId: f.users.ag1,
          type: 'company_changed',
          data: { from: null, to: f.U2 },
        },
        {
          ticketId: ticket.id,
          actorId: f.users.ag1,
          type: 'category_changed',
          data: { from: f.C1, to: f.C2 },
        },
        {
          ticketId: ticket.id,
          actorId: f.users.ag1,
          type: 'priority_changed',
          data: { from: 'low', to: 'high' },
        },
      ],
    });
    const res = await get(`/api/tickets/${ticket.id}`, 'req1');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect((res.body as TicketDetail).refs).toEqual({
      [f.users.ag1]: 'ag1',
      [f.G1]: 'Grupo 1',
      [f.G2]: 'Grupo 2',
      [f.U2]: 'Unidade 2',
      [f.C1]: 'Categoria 1',
      [f.C2]: 'Categoria 2',
    });
  });
});
