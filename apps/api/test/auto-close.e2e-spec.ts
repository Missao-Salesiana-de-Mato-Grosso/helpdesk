// T27: fechamento automático de resolvidos. A rotina horária só chama `closeExpiredResolved`.
import request from 'supertest';
import { TicketsService } from '../src/tickets/tickets.service.js';
import { SYSTEM_USER_EMAIL } from '../src/users/system-user.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe('fechamento automático de resolvidos (T27, e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;
  let systemId: string;

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
    const system = await t.prisma.user.create({
      data: { email: SYSTEM_USER_EMAIL, name: 'Sistema', active: false },
    });
    systemId = system.id;
  });

  const resolvedTicket = async (resolvedDaysAgo: number) => {
    const ticket = await f.ticket({ requester: 'req1', status: 'resolved' });
    await t.prisma.ticket.update({
      where: { id: ticket.id },
      data: { resolvedAt: daysAgo(resolvedDaysAgo) },
    });
    return ticket;
  };

  const close = (days = 7) => t.app.get(TicketsService).closeExpiredResolved(days);

  it('fecha o resolvido há mais de N dias, com evento do sistema, e sobe a versão', async () => {
    const old = await resolvedTicket(8);
    const before = await t.prisma.ticket.findUniqueOrThrow({ where: { id: old.id } });

    expect(await close()).toBe(1);

    const after = await t.prisma.ticket.findUniqueOrThrow({ where: { id: old.id } });
    expect(after.status).toBe('closed');
    expect(after.closedAt).not.toBeNull();
    expect(after.version).toBe(before.version + 1);
    const events = await t.prisma.ticketEvent.findMany({ where: { ticketId: old.id } });
    expect(events).toEqual([
      expect.objectContaining({
        actorId: systemId,
        type: 'status_changed',
        data: { from: 'resolved', to: 'closed', reason: 'auto_close' },
      }),
    ]);
    // Sem aviso por e-mail ao solicitante.
    expect(await t.prisma.notification.count()).toBe(0);
  });

  it('deixa em paz o resolvido recente e os outros status', async () => {
    const recent = await resolvedTicket(6);
    const others = await Promise.all(
      (['open', 'pending', 'closed'] as const).map((status) =>
        f.ticket({ requester: 'req1', status }),
      ),
    );
    // Só o status conta: uma data de resolução antiga em ticket reaberto não fecha nada.
    await t.prisma.ticket.updateMany({
      where: { id: { in: others.map((ticket) => ticket.id) } },
      data: { resolvedAt: daysAgo(30) },
    });

    expect(await close()).toBe(0);

    const statuses = await t.prisma.ticket.findMany({ select: { id: true, status: true } });
    expect(statuses.find((row) => row.id === recent.id)?.status).toBe('resolved');
    expect(statuses.map((row) => row.status).toSorted()).toEqual([
      'closed',
      'open',
      'pending',
      'resolved',
    ]);
    expect(await t.prisma.ticketEvent.count()).toBe(0);
  });

  it('o ticket fechado pela rotina não aceita mais alterações', async () => {
    const old = await resolvedTicket(10);
    await close();

    const res = await request(t.app.getHttpServer())
      .post(`/api/tickets/${old.id}/messages`)
      .set('Authorization', `Bearer ${await f.token('req1')}`)
      .send({ kind: 'public', bodyHtml: '<p>Ainda não funcionou</p>' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'TICKET_CLOSED' });
  });
});
