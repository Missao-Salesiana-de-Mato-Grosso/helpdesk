// Spec docs/specs/T08-T10-tickets-core.md — T08: criação, listagem, detalhe e contadores.
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TicketDetail, TicketListResponse } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { TicketsService } from '../src/tickets/tickets.service.js';
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
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as TicketListResponse;
const numbers = (body: TicketListResponse) =>
  body.items.map((item) => item.number).toSorted((a, b) => a - b);

describe('tickets — T08 (e2e)', () => {
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
  const get = async (user: Login, path: string) =>
    http()
      .get(path)
      .set('Authorization', await as(user));
  const post = async (user: Login, path: string, body: object) =>
    http()
      .post(path)
      .set('Authorization', await as(user))
      .send(body);
  const list = async (user: Login, query = '') => {
    const res = await get(user, `/api/tickets${query}`);
    expect(res.status).toBe(200);
    return listOf(res);
  };

  const newTicket = (extra: object = {}) => ({
    subject: 'Impressora da secretaria não imprime',
    bodyHtml: '<p>Desde ontem...</p>',
    categoryId: f.C1,
    ...extra,
  });

  async function ticketWithInternalNote() {
    const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
    const note = await t.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: f.users.ag1,
        kind: 'internal',
        via: 'portal',
        bodyHtml: '<p>nota</p>',
      },
    });
    await t.prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: f.users.ag1,
        type: 'message_added',
        data: { messageId: note.id, kind: 'internal' },
      },
    });
    return ticket;
  }

  describe('criação (RN-04 a RN-11)', () => {
    it('CT-01 solicitante cria em C1: #1001, open, portal, G1, U1, 1 mensagem, evento created e ticket.created', async () => {
      const emit = vi.spyOn(t.app.get(EventEmitter2), 'emit');
      const res = await post('req1', '/api/tickets', newTicket());
      expect(res.status).toBe(201);
      const body = detailOf(res);
      expect(body).toMatchObject({
        number: 1001,
        status: 'open',
        priority: 'medium',
        source: 'portal',
        version: 1,
        group: { id: f.G1 },
        company: { id: f.U1 },
        requester: { id: f.users.req1, isExternal: false },
        assignee: null,
      });
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toMatchObject({
        kind: 'public',
        via: 'portal',
        bodyHtml: '<p>Desde ontem...</p>',
        author: { id: f.users.req1, isAgent: false },
        attachments: [],
      });
      expect(body.events.map((e) => e.type)).toEqual(['created']);
      expect(emit).toHaveBeenCalledWith(
        'ticket.created',
        expect.objectContaining({
          ticketId: body.id,
          number: 1001,
          requesterId: f.users.req1,
          source: 'portal',
        }),
      );
    });

    it('CT-02 solicitante com requesterId de outro → 403 FORBIDDEN_ROLE', async () => {
      const res = await post('req1', '/api/tickets', newTicket({ requesterId: f.users.req2 }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-03 agente abre para terceiro sem unidade: source agent, company null, isExternal', async () => {
      const res = await post('ag1', '/api/tickets', newTicket({ requesterId: f.users.ext1 }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        source: 'agent',
        company: null,
        requester: { id: f.users.ext1, isExternal: true },
      });
      expect(detailOf(res).messages[0]?.author.id).toBe(f.users.ag1);
    });

    // Pelo HTTP, quem não tem unidade é barrado antes pelo guard (ONBOARDING_REQUIRED, spec T04–T05).
    // A regra vale para os outros chamadores do serviço (ex.: T21), então é testada direto nele.
    it('CT-04 criador não-agente sem unidade → 422 COMPANY_REQUIRED', async () => {
      const service = t.app.get(TicketsService);
      await expect(
        service.create(
          { id: f.users.req1, roles: [], groupIds: [], companyId: null },
          { subject: 'abc', bodyHtml: '<p>x</p>', categoryId: f.C1, priority: 'medium' },
          null,
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_REQUIRED' });
    });

    it('CT-05 categoria inativa → 422 INACTIVE_REFERENCE', async () => {
      await t.prisma.category.update({ where: { id: f.C1 }, data: { active: false } });
      const res = await post('req1', '/api/tickets', newTicket());
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INACTIVE_REFERENCE');
    });

    it('CT-05 grupo padrão inativo ou unidade informada inativa → 422 INACTIVE_REFERENCE', async () => {
      await t.prisma.group.update({ where: { id: f.G1 }, data: { active: false } });
      expect((await post('req1', '/api/tickets', newTicket())).body.code).toBe(
        'INACTIVE_REFERENCE',
      );
      await t.prisma.company.update({ where: { id: f.U2 }, data: { active: false } });
      const res = await post(
        'req1',
        '/api/tickets',
        newTicket({ categoryId: f.C2, companyId: f.U2 }),
      );
      expect(res.body.code).toBe('INACTIVE_REFERENCE');
    });

    it('CT-06 novo chamado relacionado a um fechado do próprio solicitante → 201 com relatedTicketId no evento', async () => {
      const closed = await f.ticket({ requester: 'req1', status: 'closed' });
      const res = await post('req1', '/api/tickets', newTicket({ relatedTicketId: closed.id }));
      expect(res.status).toBe(201);
      expect(detailOf(res).events[0]).toMatchObject({
        type: 'created',
        data: { relatedTicketId: closed.id },
      });
    });

    it('CT-07 relatedTicketId de outro solicitante → 404 NOT_FOUND', async () => {
      const other = await f.ticket({ requester: 'req2' });
      const res = await post('req1', '/api/tickets', newTicket({ relatedTicketId: other.id }));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('sanitiza o corpo e recusa corpo vazio (EMPTY_BODY)', async () => {
      const res = await post(
        'req1',
        '/api/tickets',
        newTicket({ bodyHtml: '<p onclick="x()">oi</p><script>x</script>' }),
      );
      expect(detailOf(res).messages[0]?.bodyHtml).toBe('<p>oi</p>');
      const empty = await post(
        'req1',
        '/api/tickets',
        newTicket({ bodyHtml: '<img src="cid:a">' }),
      );
      expect(empty.status).toBe(422);
      expect(empty.body.code).toBe('EMPTY_BODY');
    });

    it('assunto com 201 caracteres → 422 VALIDATION_ERROR', async () => {
      const res = await post('req1', '/api/tickets', newTicket({ subject: 'a'.repeat(201) }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('grava o IP do primeiro X-Forwarded-For no evento created', async () => {
      const res = await http()
        .post('/api/tickets')
        .set('Authorization', await as('req1'))
        .set('X-Forwarded-For', '10.0.0.5, 10.0.0.1')
        .send(newTicket());
      const event = await t.prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: res.body.id },
      });
      expect(event.ip).toBe('10.0.0.5');
    });
  });

  describe('listagem e detalhe (RN-12 a RN-20)', () => {
    it('CT-08 solicitante: só os seus, view requested, todos os status', async () => {
      const a = await f.ticket({ requester: 'req1' });
      const b = await f.ticket({ requester: 'req1', status: 'closed' });
      await f.ticket({ requester: 'req2' });
      expect(numbers(await list('req1'))).toEqual([a.number, b.number]);
    });

    it('CT-09 solicitante abre ticket de outro → 404', async () => {
      const other = await f.ticket({ requester: 'req2' });
      const res = await get('req1', `/api/tickets/${other.id}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect((await get('req1', '/api/tickets/nao-e-uuid')).status).toBe(404);
    });

    it('CT-10 agente: padrão é o grupo, só open/pending', async () => {
      const g1 = await f.ticket({ requester: 'req1', group: 'G1' });
      const g1Pending = await f.ticket({ requester: 'req1', group: 'G1', status: 'pending' });
      await f.ticket({ requester: 'req1', group: 'G1', status: 'resolved' });
      await f.ticket({ requester: 'req2', group: 'G2' });
      expect(numbers(await list('ag1'))).toEqual([g1.number, g1Pending.number]);
    });

    it('CT-11 ticket de G2 atribuído ao agente de G1 aparece em view=mine', async () => {
      const assigned = await f.ticket({ requester: 'req2', group: 'G2', assignee: 'ag1' });
      expect(numbers(await list('ag1', '?view=mine'))).toEqual([assigned.number]);
      expect((await get('ag1', `/api/tickets/${assigned.id}`)).status).toBe(200);
    });

    it('CT-12 ticket de G2 solicitado pelo agente aparece em requested, não em group', async () => {
      const own = await f.ticket({ requester: 'ag1', group: 'G2' });
      expect(numbers(await list('ag1', '?view=requested'))).toEqual([own.number]);
      expect(numbers(await list('ag1', '?view=group'))).toEqual([]);
    });

    it('CT-13 solicitante com view=all → 403', async () => {
      const res = await get('req1', '/api/tickets?view=all');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-14 supervisor: todos, view padrão all', async () => {
      const a = await f.ticket({ requester: 'req1', group: 'G1' });
      const b = await f.ticket({ requester: 'req2', group: 'G2' });
      expect(numbers(await list('sup'))).toEqual([a.number, b.number]);
    });

    it('CT-15 unassigned: agente vê só os do grupo (3), supervisor vê todos (5)', async () => {
      for (let i = 0; i < 3; i++) await f.ticket({ requester: 'req1', group: 'G1' });
      for (let i = 0; i < 2; i++) await f.ticket({ requester: 'req2', group: 'G2' });
      await f.ticket({ requester: 'req1', group: 'G1', assignee: 'ag1' });
      expect((await list('ag1', '?view=unassigned')).total).toBe(3);
      expect((await list('sup', '?view=unassigned')).total).toBe(5);
    });

    it('CT-16 q=#1002 e q=1002 buscam pelo número', async () => {
      await f.ticket({ requester: 'req1' });
      const second = await f.ticket({ requester: 'req1' });
      expect(second.number).toBe(1002);
      expect(numbers(await list('req1', '?q=%231002'))).toEqual([1002]);
      expect(numbers(await list('req1', '?q=1002'))).toEqual([1002]);
    });

    it('CT-17 q=impr casa o assunto sem diferenciar maiúsculas; q de 1 letra é ignorado', async () => {
      const printer = await f.ticket({ requester: 'req1', subject: 'Impressora' });
      await f.ticket({ requester: 'req1', subject: 'Internet' });
      expect(numbers(await list('req1', '?q=impr'))).toEqual([printer.number]);
      expect((await list('req1', '?q=a')).total).toBe(2);
    });

    it('CT-18 noCompany=true tem precedência sobre companyId', async () => {
      const without = await f.ticket({ requester: 'req1', company: null });
      await f.ticket({ requester: 'req1', company: 'U1' });
      expect(numbers(await list('ag1', `?noCompany=true&companyId=${f.U1}`))).toEqual([
        without.number,
      ]);
    });

    it('CT-19 paginação: 30 tickets, pageSize=10&page=2 → 10 itens e total 30; pageSize=500 → 422', async () => {
      for (let i = 0; i < 30; i++) await f.ticket({ requester: 'req1' });
      const page = await list('req1', '?pageSize=10&page=2&sort=number:asc');
      expect(page).toMatchObject({ total: 30, page: 2, pageSize: 10 });
      expect(page.items.map((item) => item.number)).toEqual(
        Array.from({ length: 10 }, (_, i) => 1011 + i),
      );
      const tooBig = await get('req1', '/api/tickets?pageSize=500');
      expect(tooBig.status).toBe(422);
      expect(tooBig.body.code).toBe('VALIDATION_ERROR');
    });

    it('CT-20 solicitante não vê nota interna nem o evento dela', async () => {
      const ticket = await ticketWithInternalNote();
      const body = detailOf(await get('req1', `/api/tickets/${ticket.id}`));
      expect(body.messages.map((m) => m.kind)).toEqual(['public']);
      expect(body.events.map((e) => e.type)).toEqual(['created']);
    });

    it('CT-21 agente vê as 2 mensagens e os 2 eventos', async () => {
      const ticket = await ticketWithInternalNote();
      const body = detailOf(await get('ag1', `/api/tickets/${ticket.id}`));
      expect(body.messages.map((m) => m.kind)).toEqual(['public', 'internal']);
      expect(body.events.map((e) => e.type)).toEqual(['created', 'message_added']);
    });

    it('CT-20 a nota interna também não muda o lastMessageAt da listagem do solicitante', async () => {
      const ticket = await ticketWithInternalNote();
      const items = (await list('req1')).items;
      const first = await t.prisma.ticketMessage.findFirstOrThrow({
        where: { ticketId: ticket.id, kind: 'public' },
      });
      expect(items[0]?.lastMessageAt).toBe(first.createdAt.toISOString());
    });

    it('CT-22 contadores do agente; solicitante → 403', async () => {
      for (let i = 0; i < 3; i++) await f.ticket({ requester: 'req1', group: 'G1' });
      for (let i = 0; i < 2; i++) await f.ticket({ requester: 'req2', group: 'G2' });
      await f.ticket({ requester: 'req1', group: 'G1', assignee: 'ag1', company: null });
      await f.ticket({ requester: 'req1', group: 'G1', status: 'closed' });
      const res = await get('ag1', '/api/tickets/counters');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mine: 1, group: 4, unassigned: 3, noCompany: 1 });
      expect((await get('req1', '/api/tickets/counters')).status).toBe(403);
    });
  });
});
