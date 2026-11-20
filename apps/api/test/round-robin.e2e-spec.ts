// Spec docs/specs/T36-round-robin.md — distribuição automática por grupo.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { GroupItem, TicketDetail } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { InboundEmailService } from '../src/inbound-email/inbound-email.service.js';
import { SYSTEM_USER_EMAIL } from '../src/users/system-user.js';
import { E2E_INBOX_PATH } from '../vitest.config.e2e.js';
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
const groupsOf = (res: Response) => res.body as GroupItem[];
const email = (user: FixtureUser) => `${user}@missaosalesiana.org.br`;

describe('distribuição automática por grupo, T36 (e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;
  let systemId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await rm(E2E_INBOX_PATH, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    vi.restoreAllMocks();
    f = await createTicketsFixture(t);
    const system = await t.prisma.user.create({
      data: { email: SYSTEM_USER_EMAIL, name: 'Sistema', active: false },
    });
    systemId = system.id;
    // ag1 e ag2 no G1 (ag2 também continua no G2): o rodízio do G1 alterna entre os dois.
    await t.prisma.groupMember.create({ data: { groupId: f.G1, userId: f.users.ag2 } });
  });

  const http = () => request(t.app.getHttpServer());
  const as = async (user: Login) => `Bearer ${await f.token(user)}`;
  const autoAssign = (groupId: string, on = true) =>
    t.prisma.group.update({ where: { id: groupId }, data: { autoAssign: on } });
  const open = async (user: Login = 'req1', extra: object = {}) =>
    http()
      .post('/api/tickets')
      .set('Authorization', await as(user))
      .send({ subject: 'Sem internet', bodyHtml: '<p>Caiu</p>', categoryId: f.C1, ...extra });
  const assigneeOf = async (res: Response) => {
    expect(res.status).toBe(201);
    return (await t.prisma.ticket.findUniqueOrThrow({ where: { id: detailOf(res).id } }))
      .assigneeId;
  };
  const patch = async (id: string, body: object, user: Login = 'sup') =>
    http()
      .patch(`/api/tickets/${id}`)
      .set('Authorization', await as(user))
      .send(body);
  const row = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });
  const lastOf = async (groupId: string) =>
    (await t.prisma.group.findUniqueOrThrow({ where: { id: groupId } })).lastAutoAssigneeId;
  const eventsOf = (id: string) =>
    t.prisma.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { id: 'asc' } });
  const outbox = async (template: string) =>
    (await t.prisma.notification.findMany({ where: { template } })).map((n) => n.toEmail);

  describe('criação (RN-03 a RN-06)', () => {
    it('CT-06 portal: alterna em ordem alfabética, grava o último e o evento do sistema', async () => {
      await autoAssign(f.G1);
      const first = await open();
      const second = await open();
      const third = await open();
      expect([await assigneeOf(first), await assigneeOf(second), await assigneeOf(third)]).toEqual([
        f.users.ag1,
        f.users.ag2,
        f.users.ag1,
      ]);
      expect(await lastOf(f.G1)).toBe(f.users.ag1);

      const events = await eventsOf(detailOf(first).id);
      expect(events.map((e) => e.type)).toEqual(['created', 'assigned']);
      expect(events[1]).toMatchObject({
        actorId: systemId,
        data: { from: null, to: f.users.ag1, reason: 'round_robin' },
      });
      expect(detailOf(first).assignee?.id).toBe(f.users.ag1);
      expect(await row(detailOf(first).id)).toMatchObject({ version: 1 });
    });

    it('CT-07 e-mail novo: o chamado nasce com o responsável do rodízio', async () => {
      await autoAssign(f.G1);
      await t.prisma.category.create({ data: { name: 'Geral', defaultGroupId: f.G1 } });
      await rm(E2E_INBOX_PATH, { recursive: true, force: true });
      await mkdir(E2E_INBOX_PATH, { recursive: true });
      await writeFile(
        join(E2E_INBOX_PATH, '0001.eml'),
        [
          `From: ${email('req1')}`,
          'To: suporte@missaosalesiana.org.br',
          'Subject: Projetor queimado',
          'Date: Thu, 19 Nov 2026 12:00:00 -0400',
          `Message-ID: <t36-${Date.now()}@teste.org>`,
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          'O projetor da sala 3 não liga.',
          '',
        ].join('\n'),
      );
      const result = await t.app.get(InboundEmailService).pollMailbox();
      expect(result).toMatchObject({ processed: 1 });
      const ticket = await t.prisma.ticket.findFirstOrThrow({ where: { source: 'email' } });
      expect(ticket.assigneeId).toBe(f.users.ag1);
    });

    it('CT-08 agente abre em nome do solicitante: fica sem responsável', async () => {
      await autoAssign(f.G1);
      const res = await open('ag1', { requesterId: f.users.req1 });
      expect(await assigneeOf(res)).toBeNull();
      expect(await lastOf(f.G1)).toBeNull();
    });

    it('CT-09 grupo sem distribuição: fica sem responsável', async () => {
      expect(await assigneeOf(await open())).toBeNull();
    });

    it('CT-10 só agentes ativos entram no rodízio', async () => {
      await autoAssign(f.G1);
      await t.prisma.groupMember.deleteMany({ where: { groupId: f.G1 } });
      const user = (name: string, data: object) =>
        t.prisma.user.create({
          data: { email: `${name}@missaosalesiana.org.br`, name, ...data },
        });
      const ana = await user('Ana', { roles: ['agente'], active: false });
      const bia = await user('Bia', { roles: [] });
      const caio = await user('Caio', { roles: ['agente'] });
      await t.prisma.groupMember.createMany({
        data: [ana, bia, caio].map((u) => ({ groupId: f.G1, userId: u.id })),
      });
      expect(await assigneeOf(await open())).toBe(caio.id);
    });

    it('CT-11 nenhum elegível: 201 sem responsável e aviso no log', async () => {
      await autoAssign(f.G1);
      await t.prisma.groupMember.deleteMany({ where: { groupId: f.G1 } });
      const warn = vi.spyOn(Logger.prototype, 'warn');
      expect(await assigneeOf(await open())).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('nenhum agente elegível'));
    });
  });

  describe('mudança de grupo (RN-03c, RN-04)', () => {
    it('CT-12 sem responsável, movido para grupo que distribui: atribui no mesmo incremento', async () => {
      await autoAssign(f.G1);
      const ticket = await f.ticket({ requester: 'req2', group: 'G2' });
      const res = await patch(ticket.id, { version: 1, groupId: f.G1 });
      expect(res.status).toBe(200);
      expect(await row(ticket.id)).toMatchObject({
        groupId: f.G1,
        assigneeId: f.users.ag1,
        version: 2,
      });
      const events = await eventsOf(ticket.id);
      expect(events.slice(1).map((e) => [e.type, e.actorId])).toEqual([
        ['group_changed', f.users.sup],
        ['assigned', systemId],
      ]);
      expect(events[2]?.data).toMatchObject({ reason: 'round_robin' });
    });

    it('CT-13 com responsável: continua com ele e o rodízio não anda', async () => {
      await autoAssign(f.G1);
      const ticket = await f.ticket({ requester: 'req2', group: 'G2', assignee: 'ag2' });
      expect((await patch(ticket.id, { version: 1, groupId: f.G1 })).status).toBe(200);
      expect(await row(ticket.id)).toMatchObject({ assigneeId: f.users.ag2 });
      expect(await lastOf(f.G1)).toBeNull();
    });

    it('CT-14 muda o grupo e tira o responsável no mesmo corpo: fica sem responsável', async () => {
      await autoAssign(f.G1);
      const ticket = await f.ticket({ requester: 'req2', group: 'G2', assignee: 'ag2' });
      const res = await patch(ticket.id, { version: 1, groupId: f.G1, assigneeId: null });
      expect(res.status).toBe(200);
      expect(await row(ticket.id)).toMatchObject({ groupId: f.G1, assigneeId: null });
    });

    it('CT-15 em lote: cada chamado na sua vez, na ordem enviada', async () => {
      await autoAssign(f.G1);
      const tickets = [
        await f.ticket({ requester: 'req2', group: 'G2' }),
        await f.ticket({ requester: 'req2', group: 'G2' }),
        await f.ticket({ requester: 'req2', group: 'G2' }),
      ];
      const res = await http()
        .patch('/api/tickets/bulk')
        .set('Authorization', await as('sup'))
        .send({
          tickets: tickets.map(({ id }) => ({ id, version: 1 })),
          changes: { groupId: f.G1 },
        });
      expect(res.status).toBe(200);
      const assignees = await Promise.all(
        tickets.map(async ({ id }) => (await row(id)).assigneeId),
      );
      expect(assignees).toEqual([f.users.ag1, f.users.ag2, f.users.ag1]);
    });
  });

  it('CT-16 duas criações simultâneas não caem no mesmo agente', async () => {
    await autoAssign(f.G1);
    const [a, b] = await Promise.all([open(), open('req2')]);
    expect(new Set([await assigneeOf(a), await assigneeOf(b)])).toEqual(
      new Set([f.users.ag1, f.users.ag2]),
    );
  });

  describe('avisos (RN-10, RN-13, RN-14)', () => {
    it('CT-17 o atribuído recebe o ticket_assigned; o aviso ao grupo continua', async () => {
      await autoAssign(f.G1);
      await open();
      expect(await outbox('ticket_assigned')).toEqual([email('ag1')]);
      expect(await outbox('ticket_created_group')).toEqual(
        expect.arrayContaining([email('ag1'), email('ag2')]),
      );
    });

    it('CT-18 atribuição manual: sem ticket_assigned e o rodízio não anda', async () => {
      await autoAssign(f.G1);
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await patch(ticket.id, { version: 1, assigneeId: f.users.ag2 });
      expect(res.status).toBe(200);
      expect(await outbox('ticket_assigned')).toEqual([]);
      expect(await lastOf(f.G1)).toBeNull();
    });
  });

  it('CT-19 admin liga a distribuição pela tela de grupos; agente não', async () => {
    const res = await http()
      .patch(`/api/admin/groups/${f.G1}`)
      .set('Authorization', await as('adm'))
      .send({ autoAssign: true });
    expect(res.status).toBe(200);
    const list = await http()
      .get('/api/admin/groups')
      .set('Authorization', await as('adm'));
    expect(groupsOf(list).find((g) => g.id === f.G1)).toMatchObject({ autoAssign: true });

    const denied = await http()
      .patch(`/api/admin/groups/${f.G1}`)
      .set('Authorization', await as('ag1'))
      .send({ autoAssign: false });
    expect(denied.status).toBe(403);
    expect(await t.prisma.group.findUniqueOrThrow({ where: { id: f.G1 } })).toMatchObject({
      autoAssign: true,
    });
  });
});
