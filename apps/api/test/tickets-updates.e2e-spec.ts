// Spec docs/specs/T08-T10-tickets-core.md — T09 (PATCH) e T10 (mensagens).
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TicketDetail } from '@helpdesk/shared';
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
const detailOf = (res: Response) => res.body as TicketDetail;

describe('tickets — T09 e T10 (e2e)', () => {
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
  const patch = async (user: Login, id: string, body: object) =>
    http()
      .patch(`/api/tickets/${id}`)
      .set('Authorization', await as(user))
      .send(body);
  const message = async (user: Login, id: string, body: object) =>
    http()
      .post(`/api/tickets/${id}/messages`)
      .set('Authorization', await as(user))
      .send(body);
  const reply = { kind: 'public', bodyHtml: '<p>Resposta</p>' };
  const row = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
  const eventsOf = (id: string) =>
    t.prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { id: 'asc' } });
  const spyEmit = () => vi.spyOn(t.app.get(EventEmitter2), 'emit');

  describe('PATCH /api/tickets/:id (RN-21 a RN-30)', () => {
    it('CT-23 solicitante → 403', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await patch('req1', ticket.id, { version: 1, priority: 'high' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-24 prioridade: version 2 e evento priority_changed; ticket.updated', async () => {
      const emit = spyEmit();
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await patch('ag1', ticket.id, { version: 1, priority: 'high' });
      expect(res.status).toBe(200);
      expect(detailOf(res)).toMatchObject({ version: 2, priority: 'high' });
      const last = (await eventsOf(ticket.id)).at(-1);
      expect(last).toMatchObject({
        type: 'priority_changed',
        data: { from: 'medium', to: 'high' },
        actorId: f.users.ag1,
      });
      expect(emit).toHaveBeenCalledWith('ticket.updated', {
        ticketId: ticket.id,
        actorId: f.users.ag1,
        changes: ['priority_changed'],
      });
    });

    it('CT-25 versão desatualizada → 409 com currentVersion, nada gravado', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await patch('ag1', ticket.id, { version: 1, priority: 'high' }).then((r) =>
        expect(r.status).toBe(200),
      );
      const res = await patch('ag1', ticket.id, { version: 1, priority: 'low' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
      expect(await row(ticket.id)).toMatchObject({ priority: 'high', version: 2 });
    });

    it('CT-26 fechar preenche closed_at; depois nada muda (TICKET_CLOSED)', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await patch('ag1', ticket.id, { version: 1, status: 'closed' });
      expect(res.status).toBe(200);
      expect(detailOf(res).closedAt).not.toBeNull();
      const again = await patch('ag1', ticket.id, { version: 2, status: 'open' });
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('TICKET_CLOSED');
    });

    it('CT-27 resolved → pending → 422 INVALID_TRANSITION', async () => {
      const ticket = await f.ticket({ requester: 'req1', status: 'resolved' });
      const res = await patch('ag1', ticket.id, { version: 1, status: 'pending' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_TRANSITION');
    });

    it('CT-28 resolver sem unidade → COMPANY_REQUIRED; com companyId no corpo → 200', async () => {
      const ticket = await f.ticket({ requester: 'req1', company: null });
      const denied = await patch('ag1', ticket.id, { version: 1, status: 'resolved' });
      expect(denied.status).toBe(422);
      expect(denied.body.code).toBe('COMPANY_REQUIRED');
      const res = await patch('ag1', ticket.id, {
        version: 1,
        status: 'resolved',
        companyId: f.U1,
      });
      expect(res.status).toBe(200);
      expect(detailOf(res)).toMatchObject({ status: 'resolved', company: { id: f.U1 } });
      expect(detailOf(res).resolvedAt).not.toBeNull();
    });

    it('CT-29 reabrir: resolved_at volta a null e evento status_changed', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await patch('ag1', ticket.id, { version: 1, status: 'resolved' });
      const emit = spyEmit();
      const res = await patch('ag1', ticket.id, { version: 2, status: 'open' });
      expect(detailOf(res)).toMatchObject({ status: 'open', resolvedAt: null });
      expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
        type: 'status_changed',
        data: { from: 'resolved', to: 'open' },
      });
      expect(emit).toHaveBeenCalledWith(
        'ticket.status_changed',
        expect.objectContaining({ from: 'resolved', to: 'open' }),
      );
    });

    it('CT-30 agente atribui a agente de outro grupo → 422; supervisor pode', async () => {
      const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
      const denied = await patch('ag1', ticket.id, { version: 1, assigneeId: f.users.ag2 });
      expect(denied.status).toBe(422);
      expect(denied.body.code).toBe('ASSIGNEE_NOT_IN_GROUP');
      const res = await patch('sup', ticket.id, { version: 1, assigneeId: f.users.ag2 });
      expect(res.status).toBe(200);
      expect(detailOf(res).assignee?.id).toBe(f.users.ag2);
    });

    it('CT-30 solicitante ou usuário inativo não podem ser responsáveis', async () => {
      const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
      const requester = await patch('sup', ticket.id, { version: 1, assigneeId: f.users.req2 });
      expect(requester.body.code).toBe('ASSIGNEE_NOT_IN_GROUP');
      await t.prisma.user.update({ where: { id: f.users.ag1 }, data: { active: false } });
      const inactive = await patch('sup', ticket.id, { version: 1, assigneeId: f.users.ag1 });
      expect(inactive.body.code).toBe('ASSIGNEE_NOT_IN_GROUP');
    });

    it('CT-31 assumir: evento assigned {from: null, to: ag1} e ticket.assigned', async () => {
      const emit = spyEmit();
      const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
      const res = await patch('ag1', ticket.id, { version: 1, assigneeId: f.users.ag1 });
      expect(res.status).toBe(200);
      expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
        type: 'assigned',
        data: { from: null, to: f.users.ag1 },
      });
      expect(emit).toHaveBeenCalledWith('ticket.assigned', {
        ticketId: ticket.id,
        actorId: f.users.ag1,
        from: null,
        to: f.users.ag1,
      });
    });

    it('CT-32 agente move para G2 (200) e deixa de ver o ticket (404)', async () => {
      const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
      const res = await patch('ag1', ticket.id, { version: 1, groupId: f.G2 });
      expect(res.status).toBe(200);
      expect(detailOf(res).group.id).toBe(f.G2);
      const after = await http()
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', await as('ag1'));
      expect(after.status).toBe(404);
    });

    it('CT-33 companyId com applyCompanyToRequester grava no ticket e no terceiro', async () => {
      const ticket = await f.ticket({ requester: 'ext1', company: null });
      const res = await patch('ag1', ticket.id, {
        version: 1,
        companyId: f.U2,
        applyCompanyToRequester: true,
      });
      expect(res.status).toBe(200);
      expect(detailOf(res).company?.id).toBe(f.U2);
      const ext1 = await t.prisma.user.findUniqueOrThrow({ where: { id: f.users.ext1 } });
      expect(ext1.companyId).toBe(f.U2);
      expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
        type: 'company_changed',
        data: { from: null, to: f.U2 },
      });
    });

    it('CT-33 sem a flag, grava só no ticket', async () => {
      const ticket = await f.ticket({ requester: 'ext1', company: null });
      await patch('ag1', ticket.id, { version: 1, companyId: f.U2 });
      const ext1 = await t.prisma.user.findUniqueOrThrow({ where: { id: f.users.ext1 } });
      expect(ext1.companyId).toBeNull();
    });

    it('CT-34 mesmo valor: 200, nenhum evento, version continua 1', async () => {
      const emit = spyEmit();
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await patch('ag1', ticket.id, { version: 1, priority: 'medium' });
      expect(res.status).toBe(200);
      expect(detailOf(res).version).toBe(1);
      expect((await eventsOf(ticket.id)).map((e) => e.type)).toEqual(['created']);
      expect(emit).not.toHaveBeenCalled();
    });

    it('grupo ou categoria inativos → 422 INACTIVE_REFERENCE; fora do escopo → 404', async () => {
      const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
      await t.prisma.group.update({ where: { id: f.G2 }, data: { active: false } });
      expect((await patch('ag1', ticket.id, { version: 1, groupId: f.G2 })).body.code).toBe(
        'INACTIVE_REFERENCE',
      );
      const other = await f.ticket({ requester: 'req2', group: 'G2' });
      expect((await patch('ag1', other.id, { version: 1, priority: 'high' })).status).toBe(404);
    });
  });

  describe('POST /api/tickets/:id/messages (RN-31 a RN-39)', () => {
    it('CT-35 solicitante com nota interna → 403', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('req1', ticket.id, { kind: 'internal', bodyHtml: '<p>x</p>' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-36 solicitante responde ticket de outro → 404', async () => {
      const other = await f.ticket({ requester: 'req2' });
      const res = await message('req1', other.id, reply);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('CT-37 sanitiza o corpo antes de gravar', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('req1', ticket.id, {
        kind: 'public',
        bodyHtml: '<p>oi</p><script>x()</script><a href="javascript:alert(1)">l</a>',
      });
      expect(res.status).toBe(201);
      expect(detailOf(res).messages.at(-1)?.bodyHtml).toBe(
        '<p>oi</p><a target="_blank" rel="noopener noreferrer">l</a>',
      );
    });

    it('CT-38 só imagem cid: → 422 EMPTY_BODY', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('req1', ticket.id, {
        kind: 'public',
        bodyHtml: '<img src="cid:abc">',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('EMPTY_BODY');
    });

    it('CT-39 ticket fechado → 422 TICKET_CLOSED', async () => {
      const ticket = await f.ticket({ requester: 'req1', status: 'closed' });
      const res = await message('req1', ticket.id, reply);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TICKET_CLOSED');
    });

    it('CT-40 1ª resposta pública do agente preenche first_response_at; status igual', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('ag1', ticket.id, reply);
      expect(res.status).toBe(201);
      expect(detailOf(res)).toMatchObject({ status: 'open', version: 1 });
      expect(detailOf(res).firstResponseAt).not.toBeNull();
    });

    it('CT-41 nota interna não preenche first_response_at nem muda status', async () => {
      const ticket = await f.ticket({ requester: 'req1', status: 'pending' });
      const res = await message('ag1', ticket.id, { kind: 'internal', bodyHtml: '<p>nota</p>' });
      expect(res.status).toBe(201);
      expect(detailOf(res)).toMatchObject({ status: 'pending', firstResponseAt: null });
    });

    it('CT-42 responder e marcar como pendente: version 2, eventos message_added e status_changed', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('ag1', ticket.id, { ...reply, status: 'pending', version: 1 });
      expect(res.status).toBe(201);
      expect(detailOf(res)).toMatchObject({ status: 'pending', version: 2 });
      expect((await eventsOf(ticket.id)).map((e) => e.type)).toEqual([
        'created',
        'message_added',
        'status_changed',
      ]);
    });

    it('CT-42 versão desatualizada → 409 e a mensagem não é gravada', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('ag1', ticket.id, { ...reply, status: 'pending', version: 7 });
      expect(res.status).toBe(409);
      expect(res.body.currentVersion).toBe(1);
      expect(await t.prisma.ticketMessage.count({ where: { ticketId: ticket.id } })).toBe(1);
    });

    it('CT-43 status sem version → 422 VALIDATION_ERROR', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await message('ag1', ticket.id, { ...reply, status: 'pending' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('CT-44 resposta do solicitante em pending → open', async () => {
      const ticket = await f.ticket({ requester: 'req1', status: 'pending' });
      const res = await message('req1', ticket.id, reply);
      expect(detailOf(res).status).toBe('open');
    });

    it('CT-45 resposta do solicitante em resolved → open, resolved_at null, reason requester_reply', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await patch('ag1', ticket.id, { version: 1, status: 'resolved' });
      const res = await message('req1', ticket.id, reply);
      expect(detailOf(res)).toMatchObject({ status: 'open', resolvedAt: null });
      expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
        type: 'status_changed',
        data: { from: 'resolved', to: 'open', reason: 'requester_reply' },
      });
    });

    it('CT-46 agente no próprio chamado é o solicitante: reabre e não marca 1ª resposta', async () => {
      const ticket = await f.ticket({ requester: 'ag1', group: 'G1', status: 'pending' });
      const res = await message('ag1', ticket.id, reply);
      expect(detailOf(res)).toMatchObject({ status: 'open', firstResponseAt: null });
    });

    it('CT-47 ticket.message_added com authorIsRequester correto', async () => {
      const emit = spyEmit();
      const ticket = await f.ticket({ requester: 'req1' });
      const own = detailOf(await message('req1', ticket.id, reply)).messages.at(-1);
      const agent = detailOf(await message('ag1', ticket.id, reply)).messages.at(-1);
      expect(emit).toHaveBeenCalledWith('ticket.message_added', {
        ticketId: ticket.id,
        messageId: own?.id,
        kind: 'public',
        authorId: f.users.req1,
        authorIsRequester: true,
      });
      expect(emit).toHaveBeenCalledWith('ticket.message_added', {
        ticketId: ticket.id,
        messageId: agent?.id,
        kind: 'public',
        authorId: f.users.ag1,
        authorIsRequester: false,
      });
    });

    it('RN-39 a mensagem atualiza updated_at e grava message_added {messageId, kind}', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const before = (await row(ticket.id)).updatedAt;
      const res = await message('ag1', ticket.id, { kind: 'internal', bodyHtml: '<p>n</p>' });
      expect((await row(ticket.id)).updatedAt.getTime()).toBeGreaterThan(before.getTime());
      expect((await eventsOf(ticket.id)).at(-1)).toMatchObject({
        type: 'message_added',
        data: { messageId: detailOf(res).messages.at(-1)?.id, kind: 'internal' },
      });
    });
  });

  it('CT-48 X-Forwarded-For: o primeiro IP vai para ticket_events.ip', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    await http()
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', await as('ag1'))
      .set('X-Forwarded-For', '10.0.0.5, 10.0.0.1')
      .send({ version: 1, priority: 'high' });
    await http()
      .post(`/api/tickets/${ticket.id}/messages`)
      .set('Authorization', await as('req1'))
      .set('X-Forwarded-For', '10.0.0.5, 10.0.0.1')
      .send(reply);
    const ips = (await eventsOf(ticket.id)).slice(1).map((e) => e.ip);
    expect(ips).toEqual(['10.0.0.5', '10.0.0.5']);
  });
});
