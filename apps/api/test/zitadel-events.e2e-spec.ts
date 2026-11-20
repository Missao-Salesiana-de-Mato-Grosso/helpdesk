// Spec docs/specs/T39-desligamento-zitadel.md — POST /api/integrations/zitadel/events.
import request from 'supertest';
import { signZitadelPayload } from '../src/integrations/zitadel-signature.js';
import { SYSTEM_USER_EMAIL } from '../src/users/system-user.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

/** `data.reason` de um evento (Json do Prisma). */
const reasonOf = (data: unknown) =>
  typeof data === 'object' && data !== null && 'reason' in data ? data.reason : undefined;

/** A mesma chave de vitest.config.e2e.ts. */
const KEY = 'test-signing-key';
const PATH = '/api/integrations/zitadel/events';

/** Corpo como o Zitadel manda num evento de usuário. */
const zitadelEvent = (eventType: string, sub = 'sub-ag1', aggregateType = 'user') =>
  JSON.stringify({
    aggregateID: sub,
    aggregateType,
    resourceOwner: 'org-1',
    instanceID: 'inst-1',
    version: 'v2',
    sequence: 7,
    event_type: eventType,
    created_at: new Date().toISOString(),
    userID: 'admin-1',
    event_payload: null,
  });

describe('desligamento pelo Zitadel, T39 (e2e)', () => {
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

  const send = (
    body: string,
    signature: string | null = signZitadelPayload(body, KEY, new Date()),
  ) => {
    const req = request(t.app.getHttpServer()).post(PATH).set('Content-Type', 'application/json');
    return (signature ? req.set('ZITADEL-Signature', signature) : req).send(body);
  };
  const user = (id: string) => t.prisma.user.findUniqueOrThrow({ where: { id } });
  const ticket = (id: string) => t.prisma.ticket.findUniqueOrThrow({ where: { id } });

  it('CT-02 sem assinatura ou com assinatura errada → 401, nada muda', async () => {
    const body = zitadelEvent('user.deactivated');
    for (const signature of [null, signZitadelPayload(body, 'outra-chave', new Date())]) {
      const res = await send(body, signature);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_SIGNATURE');
    }
    const old = signZitadelPayload(body, KEY, new Date(Date.now() - 10 * 60_000));
    expect((await send(body, old)).status).toBe(401);
    expect(await user(f.users.ag1)).toMatchObject({ active: true });
  });

  it('CT-04 desativado: inativa e devolve à fila os abertos e pendentes, não os resolvidos', async () => {
    const open = await f.ticket({ requester: 'req1', assignee: 'ag1' });
    const pending = await f.ticket({ requester: 'req1', assignee: 'ag1', status: 'pending' });
    const resolved = await f.ticket({ requester: 'req1', assignee: 'ag1', status: 'resolved' });

    const res = await send(zitadelEvent('user.deactivated'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ handled: true });
    expect(await user(f.users.ag1)).toMatchObject({ active: false, roles: ['agente'] });
    for (const id of [open.id, pending.id]) {
      expect(await ticket(id)).toMatchObject({ assigneeId: null, version: 2 });
      const event = await t.prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: id, type: 'assigned' },
      });
      expect(event).toMatchObject({
        actorId: systemId,
        data: { from: f.users.ag1, to: null, reason: 'user_deactivated' },
      });
    }
    expect(await ticket(resolved.id)).toMatchObject({ assigneeId: f.users.ag1, version: 1 });
  });

  it.each(['user.locked', 'user.removed'])('CT-05 %s tem o mesmo efeito', async (eventType) => {
    const open = await f.ticket({ requester: 'req1', assignee: 'ag1' });
    expect((await send(zitadelEvent(eventType))).body).toEqual({ handled: true });
    expect(await user(f.users.ag1)).toMatchObject({ active: false });
    expect(await ticket(open.id)).toMatchObject({ assigneeId: null });
  });

  it('CT-06 o mesmo evento de novo não muda nada', async () => {
    await f.ticket({ requester: 'req1', assignee: 'ag1' });
    await send(zitadelEvent('user.deactivated'));
    const before = await t.prisma.ticketEvent.count();
    const res = await send(zitadelEvent('user.removed'));
    expect(res.status).toBe(200);
    expect(await t.prisma.ticketEvent.count()).toBe(before);
  });

  it('CT-07 com distribuição automática, o rodízio escolhe outro agente', async () => {
    await t.prisma.groupMember.create({ data: { groupId: f.G1, userId: f.users.ag2 } });
    await t.prisma.group.update({ where: { id: f.G1 }, data: { autoAssign: true } });
    const open = await f.ticket({ requester: 'req1', assignee: 'ag1' });
    await send(zitadelEvent('user.deactivated'));
    expect(await ticket(open.id)).toMatchObject({ assigneeId: f.users.ag2, version: 2 });
    const reasons = (
      await t.prisma.ticketEvent.findMany({
        where: { ticketId: open.id, type: 'assigned' },
        orderBy: { id: 'asc' },
      })
    ).map((e) => reasonOf(e.data));
    expect(reasons).toEqual(['user_deactivated', 'round_robin']);
  });

  it('CT-08 sub desconhecido, outro evento ou outro tipo de agregado → handled: false', async () => {
    for (const body of [
      zitadelEvent('user.deactivated', 'sub-ninguem'),
      zitadelEvent('user.human.added'),
      zitadelEvent('user.deactivated', 'sub-ag1', 'org'),
    ]) {
      const res = await send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handled: false });
    }
    expect(await user(f.users.ag1)).toMatchObject({ active: true });
  });

  it('CT-09 corpo assinado sem aggregateID → 400', async () => {
    const body = JSON.stringify({ event_type: 'user.deactivated', aggregateType: 'user' });
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('CT-10 com token ainda válido, a próxima requisição já é recusada', async () => {
    const token = await f.token('ag1');
    const http = () =>
      request(t.app.getHttpServer()).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect((await http()).status).toBe(200);
    await send(zitadelEvent('user.deactivated'));
    const res = await http();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('USER_INACTIVE');
  });
});
