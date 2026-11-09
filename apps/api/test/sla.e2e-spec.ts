// T28: SLA. A autorização por papel está na matriz de permissões; aqui ficam as regras. O cálculo de
// horário útil tem teste unitário (src/sla/business-time.spec.ts): aqui o calendário é 24×7, para
// os prazos darem `abertura + meta` sem depender da hora em que o teste roda.
import type { TicketCounters, TicketDetail, TicketListResponse } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { TicketsService } from '../src/tickets/tickets.service.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

// Corpo da resposta tipado pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const detailOf = (res: Response) => res.body as TicketDetail;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as TicketListResponse;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const countersOf = (res: Response) => res.body as TicketCounters;

const MINUTE_MS = 60_000;
const minutesAfter = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();

const POLICIES = [
  { priority: 'urgent', firstResponseMinutes: 60, resolutionMinutes: 240 },
  { priority: 'high', firstResponseMinutes: 240, resolutionMinutes: 480 },
  { priority: 'medium', firstResponseMinutes: 480, resolutionMinutes: 1440 },
  { priority: 'low', firstResponseMinutes: 960, resolutionMinutes: 2400 },
] as const;

describe('SLA (T28, e2e)', () => {
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
    await t.prisma.slaPolicy.createMany({ data: POLICIES.map((policy) => ({ ...policy })) });
    await t.prisma.businessHours.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
    });
  });

  const http = () => request(t.app.getHttpServer());
  const auth = async (user: 'req1' | 'ag1' | 'adm') => `Bearer ${await f.token(user)}`;

  const open = async (priority: 'high' | 'medium' = 'high') => {
    const res = await http()
      .post('/api/tickets')
      .set('Authorization', await auth('req1'))
      .send({ subject: 'Sem internet', bodyHtml: '<p>Caiu</p>', categoryId: f.C1, priority });
    expect(res.status).toBe(201);
    return detailOf(res);
  };
  const get = async (id: string, user: 'req1' | 'ag1' = 'ag1') =>
    detailOf(
      await http()
        .get(`/api/tickets/${id}`)
        .set('Authorization', await auth(user)),
    );
  const patch = async (id: string, body: object) => {
    const res = await http()
      .patch(`/api/tickets/${id}`)
      .set('Authorization', await auth('ag1'))
      .send(body);
    expect(res.status).toBe(200);
    return detailOf(res);
  };

  it('ticket novo recebe os prazos da prioridade; só o agente vê o SLA', async () => {
    const created = await open('high');
    expect(created.sla).toBeNull(); // quem abriu é o solicitante

    const ticket = await get(created.id);
    expect(ticket.sla).toEqual({
      firstResponse: { dueAt: minutesAfter(ticket.createdAt, 240), doneAt: null },
      resolution: { dueAt: minutesAfter(ticket.createdAt, 480), doneAt: null },
      pausedAt: null,
    });
    expect((await get(created.id, 'req1')).sla).toBeNull();
  });

  it('pendente pausa; ao reabrir, o tempo pausado empurra os prazos', async () => {
    const created = await open('high');
    const paused = await patch(created.id, { version: 1, status: 'pending' });
    expect(paused.sla?.pausedAt).not.toBeNull();

    // A pausa começou há 90 minutos.
    await t.prisma.ticket.update({
      where: { id: created.id },
      data: { slaPausedAt: new Date(Date.now() - 90 * MINUTE_MS) },
    });
    const reopened = await patch(created.id, { version: paused.version, status: 'open' });

    const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.slaPausedMinutes).toBe(90);
    expect(reopened.sla).toEqual({
      firstResponse: { dueAt: minutesAfter(created.createdAt, 240 + 90), doneAt: null },
      resolution: { dueAt: minutesAfter(created.createdAt, 480 + 90), doneAt: null },
      pausedAt: null,
    });
  });

  it('trocar a prioridade recalcula os prazos', async () => {
    const created = await open('high');
    const changed = await patch(created.id, { version: 1, priority: 'medium' });
    expect(changed.sla?.firstResponse?.dueAt).toBe(minutesAfter(created.createdAt, 480));
    expect(changed.sla?.resolution?.dueAt).toBe(minutesAfter(created.createdAt, 1440));
  });

  it('filtro e contador de SLA vencido: só abertos com prazo estourado', async () => {
    const late = await open();
    await open(); // no prazo
    const waiting = await open();
    await patch(waiting.id, { version: 1, status: 'pending' });
    const past = new Date(Date.now() - MINUTE_MS);
    await t.prisma.ticket.updateMany({
      where: { id: { in: [late.id, waiting.id] } },
      data: { firstResponseDueAt: past },
    });

    const list = listOf(
      await http()
        .get('/api/tickets?view=all&status=open&status=pending&slaBreached=true')
        .set('Authorization', await auth('ag1')),
    );
    expect(list.items.map((item) => item.id)).toEqual([late.id]);
    expect(list.items[0]!.sla?.firstResponse?.doneAt).toBeNull();

    const counters = countersOf(
      await http()
        .get('/api/tickets/counters')
        .set('Authorization', await auth('ag1')),
    );
    expect(counters.slaBreached).toBe(1);
  });

  it('mudar as metas pelo admin recalcula os tickets não fechados', async () => {
    const created = await open('high');
    const res = await http()
      .put('/api/admin/sla/policies')
      .set('Authorization', await auth('adm'))
      .send(POLICIES.map((policy) => ({ ...policy, firstResponseMinutes: 30 })));
    expect(res.status).toBe(200);

    const ticket = await get(created.id);
    expect(ticket.sla?.firstResponse?.dueAt).toBe(minutesAfter(created.createdAt, 30));
    expect(ticket.updatedAt).toBe(created.updatedAt); // recálculo não conta como atualização
  });

  it('feriado: data repetida → 409 DATE_TAKEN; excluir inexistente → 404', async () => {
    const token = await auth('adm');
    const holiday = { date: '2026-04-08', name: 'Aniversário de Cuiabá' };
    const first = await http()
      .post('/api/admin/holidays')
      .set('Authorization', token)
      .send(holiday);
    expect(first.status).toBe(201);
    const again = await http()
      .post('/api/admin/holidays')
      .set('Authorization', token)
      .send(holiday);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'DATE_TAKEN' });

    const listed = await http().get('/api/admin/holidays').set('Authorization', token);
    expect(listed.body).toEqual([{ id: expect.any(String), ...holiday }]);

    for (const id of ['00000000-0000-4000-8000-000000000000', 'abc']) {
      const res = await http().delete(`/api/admin/holidays/${id}`).set('Authorization', token);
      expect(res.status).toBe(404);
    }
  });

  it('backfill: ticket sem prazo ganha prazo; o pendente fica pausado', async () => {
    const running = await f.ticket({ requester: 'req1', status: 'open', priority: 'urgent' });
    const waiting = await f.ticket({ requester: 'req1', status: 'pending' });

    expect(await t.app.get(TicketsService).recomputeSla(true)).toBe(2);

    const rows = await t.prisma.ticket.findMany({
      where: { id: { in: [running.id, waiting.id] } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const urgent = byId.get(running.id)!;
    expect(urgent.firstResponseDueAt?.getTime()).toBe(urgent.createdAt.getTime() + 60 * MINUTE_MS);
    expect(urgent.slaPausedAt).toBeNull();
    expect(byId.get(waiting.id)!.slaPausedAt).not.toBeNull();
  });
});
