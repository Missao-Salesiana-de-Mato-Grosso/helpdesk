// Spec docs/specs/T35-acoes-em-lote.md — PATCH /api/tickets/bulk.
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { BulkUpdateTicketsResponse, TicketListResponse } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import {
  createTicketsFixture,
  type FixtureUser,
  type TicketsFixture,
} from './setup/tickets-fixture.js';

type Login = Exclude<FixtureUser, 'ext1'>;

// Corpo da resposta tipado pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bulkOf = (res: Response) => res.body as BulkUpdateTicketsResponse;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as TicketListResponse;

/** Pedido com a versão inicial de cada ticket da fixture. */
const v1 = (...tickets: { id: string }[]) => tickets.map(({ id }) => ({ id, version: 1 }));

const fakeId = (n: number) => `0b6f2a52-6f0e-4d7e-9a43-${n.toString().padStart(12, '0')}`;

describe('tickets — ações em lote, T35 (e2e)', () => {
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
    vi.restoreAllMocks();
    f = await createTicketsFixture(t);
  });

  const http = () => request(t.app.getHttpServer());
  const as = async (user: Login) => `Bearer ${await f.token(user)}`;
  const bulk = async (user: Login, body: object) =>
    http()
      .patch('/api/tickets/bulk')
      .set('Authorization', await as(user))
      .send(body);
  const row = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
  const eventsOf = (id: string) =>
    t.prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { id: 'asc' } });
  const outbox = () => t.prisma.notification.findMany();
  const spyEmit = () => vi.spyOn(t.app.get(EventEmitter2), 'emit');

  describe('validação do pedido (RN-02 a RN-04)', () => {
    it('CT-02 0, 101, repetido ou id inválido → 422 VALIDATION_ERROR, nada muda', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const changes = { priority: 'high' };
      const bodies = [
        { tickets: [], changes },
        {
          tickets: [
            { id: t1.id, version: 1 },
            ...Array.from({ length: 100 }, (_, n) => ({ id: fakeId(n), version: 1 })),
          ],
          changes,
        },
        { tickets: [...v1(t1), ...v1(t1)], changes },
        { tickets: [{ id: 'nao-e-uuid', version: 1 }], changes },
      ];
      for (const body of bodies) {
        const res = await bulk('ag1', body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect(await row(t1.id)).toMatchObject({ priority: 'medium', version: 1 });
    });

    it('CT-03 nenhum campo, dois campos, applyCompanyToRequester ou campo desconhecido → 422', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const tickets = v1(t1);
      const changesList = [
        {},
        { priority: 'high', status: 'closed' },
        { groupId: f.G2, assigneeId: f.users.ag2 },
        { companyId: f.U2, applyCompanyToRequester: true },
        { subject: 'Outro' },
      ];
      for (const changes of changesList) {
        const res = await bulk('ag1', { tickets, changes });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect(await row(t1.id)).toMatchObject({ priority: 'medium', groupId: f.G1, version: 1 });
    });

    it('CT-04 grupo inativo → 422 INACTIVE_REFERENCE, nenhum ticket muda', async () => {
      const G3 = await t.prisma.group.create({ data: { name: 'Grupo 3', active: false } });
      const tickets = await Promise.all([1, 2, 3].map(() => f.ticket({ requester: 'req1' })));
      const res = await bulk('ag1', { tickets: v1(...tickets), changes: { groupId: G3.id } });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INACTIVE_REFERENCE');
      for (const ticket of tickets) {
        expect(await row(ticket.id)).toMatchObject({ groupId: f.G1, version: 1 });
        expect(await eventsOf(ticket.id)).toHaveLength(1); // só o `created`
      }
    });
  });

  describe('por ticket (RN-05 a RN-10, RN-13, RN-14)', () => {
    it('CT-05 prioridade em 3 tickets: version + 1 e um priority_changed em cada', async () => {
      const tickets = await Promise.all([1, 2, 3].map(() => f.ticket({ requester: 'req1' })));
      const res = await bulk('ag1', { tickets: v1(...tickets), changes: { priority: 'high' } });
      expect(res.status).toBe(200);
      expect(bulkOf(res)).toMatchObject({ succeeded: 3, failed: 0 });
      for (const [i, ticket] of tickets.entries()) {
        expect(bulkOf(res).results[i]).toEqual({
          id: ticket.id,
          ok: true,
          number: ticket.number,
          changed: true,
          version: 2,
        });
        expect(await row(ticket.id)).toMatchObject({ priority: 'high', version: 2 });
        expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
          type: 'priority_changed',
          data: { from: 'medium', to: 'high' },
          actorId: f.users.ag1,
        });
      }
    });

    it('CT-06 fechar: com unidade fecha; sem unidade e já fechado falham sem alterar', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t2 = await f.ticket({ requester: 'req1', company: null });
      const t3 = await f.ticket({ requester: 'req1', status: 'closed' });
      const res = await bulk('ag1', { tickets: v1(t1, t2, t3), changes: { status: 'closed' } });
      expect(res.status).toBe(200);
      const [r1, r2, r3] = bulkOf(res).results;
      expect(r1).toMatchObject({ ok: true, changed: true, version: 2 });
      expect(r2).toMatchObject({ ok: false, number: t2.number, code: 'COMPANY_REQUIRED' });
      expect(r3).toMatchObject({ ok: false, number: t3.number, code: 'TICKET_CLOSED' });
      expect(await row(t1.id)).toMatchObject({ status: 'closed' });
      expect((await row(t1.id)).closedAt).not.toBeNull();
      for (const ticket of [t2, t3]) {
        expect(await row(ticket.id)).toMatchObject({ version: 1 });
        expect(await eventsOf(ticket.id)).toHaveLength(1);
      }
    });

    it('CT-07 versão desatualizada falha só aquele ticket', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t2 = await f.ticket({ requester: 'req1' });
      await t.prisma.ticket.update({ where: { id: t1.id }, data: { version: 2 } });
      const res = await bulk('ag1', { tickets: v1(t1, t2), changes: { priority: 'urgent' } });
      const [r1, r2] = bulkOf(res).results;
      expect(r1).toMatchObject({ ok: false, number: t1.number, code: 'VERSION_CONFLICT' });
      expect(r2).toMatchObject({ ok: true, changed: true });
      expect(await row(t1.id)).toMatchObject({ priority: 'medium', version: 2 });
      expect(await row(t2.id)).toMatchObject({ priority: 'urgent', version: 2 });
    });

    it('CT-08 fora do escopo → NOT_FOUND sem number, e o ticket não muda', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t4 = await f.ticket({ requester: 'req2', group: 'G2' });
      const res = await bulk('ag1', { tickets: v1(t1, t4), changes: { priority: 'high' } });
      const [r1, r4] = bulkOf(res).results;
      expect(r1).toMatchObject({ ok: true });
      expect(r4).toEqual({
        id: t4.id,
        ok: false,
        code: 'NOT_FOUND',
        message: expect.any(String),
      });
      expect(r4).not.toHaveProperty('number');
      expect(await row(t4.id)).toMatchObject({ priority: 'medium', version: 1 });
    });

    it('CT-09 valor igual ao atual: sucesso sem alteração, mesma versão e sem evento', async () => {
      const t1 = await f.ticket({ requester: 'req1', priority: 'high' });
      const t2 = await f.ticket({ requester: 'req1' });
      const res = await bulk('ag1', { tickets: v1(t1, t2), changes: { priority: 'high' } });
      const [r1, r2] = bulkOf(res).results;
      expect(r1).toMatchObject({ ok: true, changed: false, version: 1 });
      expect(r2).toMatchObject({ ok: true, changed: true, version: 2 });
      expect(await row(t1.id)).toMatchObject({ version: 1 });
      expect(await eventsOf(t1.id)).toHaveLength(1);
    });

    it('CT-12 mover de grupo e depois atribuir, em duas operações', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t4 = await f.ticket({ requester: 'req2', group: 'G2' });
      const moved = await bulk('sup', { tickets: v1(t1, t4), changes: { groupId: f.G2 } });
      expect(bulkOf(moved)).toMatchObject({ succeeded: 2 });
      expect((await eventsOf(t1.id)).at(-1)).toMatchObject({ type: 'group_changed' });

      const emit = spyEmit();
      const tickets = bulkOf(moved).results.map((r) => ({
        id: r.id,
        version: r.ok ? r.version : 0,
      }));
      const assigned = await bulk('sup', { tickets, changes: { assigneeId: f.users.ag2 } });
      expect(bulkOf(assigned)).toMatchObject({ succeeded: 2, failed: 0 });
      for (const ticket of [t1, t4]) {
        expect(await row(ticket.id)).toMatchObject({ groupId: f.G2, assigneeId: f.users.ag2 });
        expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
          type: 'assigned',
          data: { from: null, to: f.users.ag2 },
        });
        expect(emit).toHaveBeenCalledWith(
          'ticket.assigned',
          expect.objectContaining({ ticketId: ticket.id, to: f.users.ag2 }),
        );
      }
    });

    it('CT-13 responsável fora do grupo → ASSIGNEE_NOT_IN_GROUP', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const res = await bulk('ag1', { tickets: v1(t1), changes: { assigneeId: f.users.ag2 } });
      expect(bulkOf(res).results[0]).toMatchObject({
        ok: false,
        number: t1.number,
        code: 'ASSIGNEE_NOT_IN_GROUP',
      });
      expect(await row(t1.id)).toMatchObject({ assigneeId: null, version: 1 });
    });

    it('CT-14 unidade em lote muda só o ticket, não o solicitante', async () => {
      const t1 = await f.ticket({ requester: 'ext1', company: null });
      const res = await bulk('ag1', { tickets: v1(t1), changes: { companyId: f.U1 } });
      expect(bulkOf(res).results[0]).toMatchObject({ ok: true, changed: true });
      expect(await row(t1.id)).toMatchObject({ companyId: f.U1 });
      expect((await eventsOf(t1.id)).at(-1)).toMatchObject({ type: 'company_changed' });
      const requester = await t.prisma.user.findUniqueOrThrow({ where: { id: f.users.ext1 } });
      expect(requester.companyId).toBeNull();
    });

    it('CT-15 resultados na ordem do pedido, com os totais', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t2 = await f.ticket({ requester: 'req1', status: 'closed' });
      const t3 = await f.ticket({ requester: 'req1' });
      const res = await bulk('ag1', { tickets: v1(t1, t2, t3), changes: { priority: 'low' } });
      expect(bulkOf(res).results.map((r) => [r.id, r.ok])).toEqual([
        [t1.id, true],
        [t2.id, false],
        [t3.id, true],
      ]);
      expect(bulkOf(res)).toMatchObject({ succeeded: 2, failed: 1 });
    });
  });

  describe('notificações e log (RN-11, RN-12)', () => {
    it('CT-10 resolver em lote: um e-mail resolved por ticket', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t2 = await f.ticket({ requester: 'req2' });
      const res = await bulk('ag1', { tickets: v1(t1, t2), changes: { status: 'resolved' } });
      expect(bulkOf(res)).toMatchObject({ succeeded: 2 });
      const resolved = (await outbox()).filter((n) => n.template === 'resolved');
      const resolvedIds = resolved.map((n) => n.ticketId);
      expect(resolvedIds).toHaveLength(2);
      expect(resolvedIds).toEqual(expect.arrayContaining([t1.id, t2.id]));
      for (const ticket of [t1, t2]) expect((await row(ticket.id)).resolvedAt).not.toBeNull();
    });

    it('CT-11 fechar em lote não enfileira e-mail', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const t2 = await f.ticket({ requester: 'req1' });
      const before = (await outbox()).length;
      const res = await bulk('ag1', { tickets: v1(t1, t2), changes: { status: 'closed' } });
      expect(bulkOf(res)).toMatchObject({ succeeded: 2 });
      expect(await outbox()).toHaveLength(before);
    });

    it('CT-16 log só com ator, total, campo e contagens', async () => {
      const logs: string[] = [];
      for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(' '));
        });
      }
      const t1 = await f.ticket({ requester: 'req1', subject: 'Assunto sigiloso' });
      const t2 = await f.ticket({
        requester: 'req1',
        subject: 'Assunto sigiloso',
        status: 'closed',
      });
      await bulk('ag1', { tickets: v1(t1, t2), changes: { priority: 'high' } });
      const text = logs.join('\n');
      expect(text).toContain(f.users.ag1);
      expect(text).toContain('2 chamados');
      expect(text).toContain('priority');
      expect(text).toContain('1 com sucesso, 1 com falha');
      expect(text).not.toContain('sigiloso');
      expect(text).not.toContain('missaosalesiana.org.br');
      expect(text).not.toContain('high');
    });
  });

  describe('rotas vizinhas', () => {
    it('CT-17 GET /tickets traz a version de cada item', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      await t.prisma.ticket.update({ where: { id: t1.id }, data: { version: 7 } });
      const res = await http()
        .get('/api/tickets?view=group')
        .set('Authorization', await as('ag1'));
      expect(res.status).toBe(200);
      expect(listOf(res).items.find((item) => item.id === t1.id)).toMatchObject({ version: 7 });
    });

    it('CT-18 PATCH /tickets/:id segue funcionando e "bulk" não é tratado como id', async () => {
      const t1 = await f.ticket({ requester: 'req1' });
      const single = await http()
        .patch(`/api/tickets/${t1.id}`)
        .set('Authorization', await as('ag1'))
        .send({ version: 1, priority: 'high' });
      expect(single.status).toBe(200);
      // Corpo do PATCH individual na rota de lote: validação do lote (422), não 404 de ticket.
      const res = await bulk('ag1', { version: 2, priority: 'low' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
