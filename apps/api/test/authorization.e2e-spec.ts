// Matriz de permissões (01-escopo): toda rota da API × cada papel. Toda rota nova entra aqui.
// Os usuários já passaram pelo 1º acesso; o bloqueio de onboarding é coberto em auth.e2e-spec.ts.
import request from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';

type Actor = 'anonimo' | 'solicitante' | 'agente' | 'supervisor' | 'admin';

const ACTORS: { actor: Actor; roles: string[] }[] = [
  { actor: 'solicitante', roles: [] },
  { actor: 'agente', roles: ['agente'] },
  { actor: 'supervisor', roles: ['supervisor'] },
  { actor: 'admin', roles: ['admin'] },
];
const ALL_ACTORS: Actor[] = ['anonimo', ...ACTORS.map((a) => a.actor)];

interface RouteCase {
  method: 'get' | 'patch' | 'post';
  /** Pode depender dos dados criados no beforeEach (ex.: id de um ticket). */
  path: string | ((ref: Refs) => string);
  body?: (ref: Refs) => object;
  /** Nome no relatório quando `path` é uma função. */
  label?: string;
  expected: Record<Actor, number>;
}

interface Refs {
  companyId: string;
  departmentId: string;
  categoryId: string;
  groupId: string;
  /** Ticket aberto pelo solicitante, no grupo do agente. */
  ticketId: string;
  /** Ticket de um terceiro, num grupo do qual o agente não participa. */
  foreignTicketId: string;
}

const AUTHENTICATED = { anonimo: 401, solicitante: 200, agente: 200, supervisor: 200, admin: 200 };
const AGENT_ONLY = { anonimo: 401, solicitante: 403, agente: 200, supervisor: 200, admin: 200 };

const MATRIX: RouteCase[] = [
  {
    method: 'get',
    path: '/api/health',
    expected: { anonimo: 200, solicitante: 200, agente: 200, supervisor: 200, admin: 200 },
  },
  { method: 'get', path: '/api/me', expected: AUTHENTICATED },
  {
    method: 'patch',
    path: '/api/me',
    body: (ref) => ({ companyId: ref.companyId, departmentId: ref.departmentId }),
    expected: AUTHENTICATED,
  },
  { method: 'get', path: '/api/companies', expected: AUTHENTICATED },
  { method: 'get', path: '/api/departments', expected: AUTHENTICATED },
  { method: 'get', path: '/api/categories', expected: AUTHENTICATED },
  { method: 'get', path: '/api/groups', expected: AGENT_ONLY },
  {
    method: 'get',
    path: (ref) => `/api/groups/${ref.groupId}/members`,
    label: '/api/groups/:id/members',
    expected: AGENT_ONLY,
  },
  {
    method: 'post',
    path: '/api/tickets',
    body: (ref) => ({ subject: 'Teste', bodyHtml: '<p>x</p>', categoryId: ref.categoryId }),
    expected: { anonimo: 401, solicitante: 201, agente: 201, supervisor: 201, admin: 201 },
  },
  { method: 'get', path: '/api/tickets', expected: AUTHENTICATED },
  { method: 'get', path: '/api/tickets/counters', expected: AGENT_ONLY },
  {
    method: 'get',
    path: (ref) => `/api/tickets/${ref.ticketId}`,
    label: '/api/tickets/:id (do solicitante, grupo do agente)',
    expected: AUTHENTICATED,
  },
  {
    // Fora do escopo → 404 (não 403), para não revelar a existência.
    method: 'get',
    path: (ref) => `/api/tickets/${ref.foreignTicketId}`,
    label: '/api/tickets/:id (fora do escopo)',
    expected: { anonimo: 401, solicitante: 404, agente: 404, supervisor: 200, admin: 200 },
  },
  {
    method: 'patch',
    path: (ref) => `/api/tickets/${ref.ticketId}`,
    label: 'PATCH /api/tickets/:id (grupo do agente)',
    body: () => ({ version: 1, priority: 'high' }),
    expected: AGENT_ONLY,
  },
  {
    method: 'patch',
    path: (ref) => `/api/tickets/${ref.foreignTicketId}`,
    label: 'PATCH /api/tickets/:id (fora do escopo)',
    body: () => ({ version: 1, priority: 'high' }),
    expected: { anonimo: 401, solicitante: 403, agente: 404, supervisor: 200, admin: 200 },
  },
  {
    method: 'post',
    path: (ref) => `/api/tickets/${ref.ticketId}/messages`,
    label: '/api/tickets/:id/messages (do solicitante, grupo do agente)',
    body: () => ({ kind: 'public', bodyHtml: '<p>oi</p>' }),
    expected: { anonimo: 401, solicitante: 201, agente: 201, supervisor: 201, admin: 201 },
  },
  {
    method: 'post',
    path: (ref) => `/api/tickets/${ref.ticketId}/messages`,
    label: '/api/tickets/:id/messages (nota interna)',
    body: () => ({ kind: 'internal', bodyHtml: '<p>oi</p>' }),
    expected: { anonimo: 401, solicitante: 403, agente: 201, supervisor: 201, admin: 201 },
  },
  {
    method: 'post',
    path: (ref) => `/api/tickets/${ref.foreignTicketId}/messages`,
    label: '/api/tickets/:id/messages (fora do escopo)',
    body: () => ({ kind: 'public', bodyHtml: '<p>oi</p>' }),
    expected: { anonimo: 401, solicitante: 404, agente: 404, supervisor: 201, admin: 201 },
  },
];

describe('matriz de permissões (e2e)', () => {
  let t: TestApp;
  let refs: Refs;
  const tokens = new Map<Actor, string>();

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    const company = await t.prisma.company.create({ data: { name: 'Sede' } });
    const department = await t.prisma.department.create({ data: { name: 'Secretaria' } });
    const ownGroup = await t.prisma.group.create({ data: { name: 'Suporte TI' } });
    const otherGroup = await t.prisma.group.create({ data: { name: 'Sistemas' } });
    const category = await t.prisma.category.create({
      data: { name: 'Geral', defaultGroupId: ownGroup.id },
    });
    const userIds = new Map<Actor, string>();
    for (const { actor, roles } of ACTORS) {
      const sub = `sub-${actor}`;
      const user = await t.prisma.user.create({
        data: {
          zitadelSub: sub,
          email: `${actor}@missaosalesiana.org.br`,
          name: actor,
          roles,
          companyId: company.id,
          departmentId: department.id,
          lastLoginAt: new Date(),
          profileSyncedAt: new Date(),
        },
      });
      userIds.set(actor, user.id);
      tokens.set(actor, await t.tokens.sign({ sub, roles }));
    }
    await t.prisma.groupMember.create({
      data: { groupId: ownGroup.id, userId: userIds.get('agente')! },
    });
    const external = await t.prisma.user.create({
      data: { email: 'terceiro@exemplo.com', name: 'Terceiro', isExternal: true },
    });
    const ticket = (requesterId: string, groupId: string) =>
      t.prisma.ticket.create({
        data: {
          subject: 'Matriz',
          source: 'portal',
          requesterId,
          groupId,
          categoryId: category.id,
          companyId: company.id,
        },
        select: { id: true },
      });
    refs = {
      companyId: company.id,
      departmentId: department.id,
      categoryId: category.id,
      groupId: ownGroup.id,
      ticketId: (await ticket(userIds.get('solicitante')!, ownGroup.id)).id,
      foreignTicketId: (await ticket(external.id, otherGroup.id)).id,
    };
  });

  const cases = MATRIX.flatMap((route) =>
    ALL_ACTORS.map((actor) => ({
      ...route,
      route: route.label ?? (typeof route.path === 'string' ? route.path : '?'),
      actor,
      status: route.expected[actor],
    })),
  );

  it.each(cases)(
    '$method $route como $actor → $status',
    async ({ method, path, body, actor, status }) => {
      const url = typeof path === 'string' ? path : path(refs);
      let req = request(t.app.getHttpServer())[method](url);
      const token = tokens.get(actor);
      if (token) req = req.set('Authorization', `Bearer ${token}`);
      if (body) req = req.send(body(refs));
      await req.expect(status);
    },
  );
});
