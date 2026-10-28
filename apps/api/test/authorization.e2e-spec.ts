// Matriz de permissões (01-escopo): toda rota da API × cada papel. Toda rota nova entra aqui.
// Os usuários já passaram pelo 1º acesso; o bloqueio de onboarding é coberto em auth.e2e-spec.ts.
import request from 'supertest';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';

// T22: 'pendente' é um solicitante cujo access_status ainda é pending (RN-06) — bloqueado em
// tudo, exceto /me, /companies e /departments. Não tem papel no Zitadel, por isso não é
// auto-aprovado pela RN-04.
type Actor = 'anonimo' | 'solicitante' | 'agente' | 'supervisor' | 'admin' | 'pendente';

const ACTORS: { actor: Actor; roles: string[]; accessStatus: 'approved' | 'pending' }[] = [
  { actor: 'solicitante', roles: [], accessStatus: 'approved' },
  { actor: 'agente', roles: ['agente'], accessStatus: 'approved' },
  { actor: 'supervisor', roles: ['supervisor'], accessStatus: 'approved' },
  { actor: 'admin', roles: ['admin'], accessStatus: 'approved' },
  { actor: 'pendente', roles: [], accessStatus: 'pending' },
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
  attachmentId: string;
  foreignAttachmentId: string;
  /** Pedido de acesso pending recém-criado, para os testes de liberação (T22). */
  pendingUserId: string;
}

// pendente: 403 ACCESS_PENDING por padrão (RN-06); as rotas isentas (/me, /companies,
// /departments) sobrescrevem com `{ ...AUTHENTICATED, pendente: 200 }`.
const AUTHENTICATED = {
  anonimo: 401,
  solicitante: 200,
  agente: 200,
  supervisor: 200,
  admin: 200,
  pendente: 403,
};
const AGENT_ONLY = {
  anonimo: 401,
  solicitante: 403,
  agente: 200,
  supervisor: 200,
  admin: 200,
  pendente: 403,
};
/** Rotas de liberação (T22): só admin e supervisor; "admin" nesta spec inclui supervisor. */
const ADMIN_OR_SUPERVISOR = {
  anonimo: 401,
  solicitante: 403,
  agente: 403,
  supervisor: 200,
  admin: 200,
  pendente: 403,
};

const MATRIX: RouteCase[] = [
  {
    method: 'get',
    path: '/api/health',
    expected: {
      anonimo: 200,
      solicitante: 200,
      agente: 200,
      supervisor: 200,
      admin: 200,
      pendente: 200,
    },
  },
  // T22 RN-06: /me, /companies e /departments são as únicas rotas abertas a quem está pending.
  { method: 'get', path: '/api/me', expected: { ...AUTHENTICATED, pendente: 200 } },
  {
    method: 'patch',
    path: '/api/me',
    body: (ref) => ({ companyId: ref.companyId, departmentId: ref.departmentId }),
    expected: { ...AUTHENTICATED, pendente: 200 },
  },
  { method: 'get', path: '/api/companies', expected: { ...AUTHENTICATED, pendente: 200 } },
  { method: 'get', path: '/api/departments', expected: { ...AUTHENTICATED, pendente: 200 } },
  { method: 'get', path: '/api/categories', expected: AUTHENTICATED },
  { method: 'get', path: '/api/groups', expected: AGENT_ONLY },
  {
    method: 'get',
    path: (ref) => `/api/attachments/${ref.attachmentId}`,
    label: '/api/attachments/:id (do solicitante, grupo do agente)',
    expected: AUTHENTICATED,
  },
  {
    method: 'get',
    path: (ref) => `/api/attachments/${ref.foreignAttachmentId}`,
    label: '/api/attachments/:id (fora do escopo)',
    expected: {
      anonimo: 401,
      solicitante: 404,
      agente: 404,
      supervisor: 200,
      admin: 200,
      pendente: 403,
    },
  },
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
    expected: {
      anonimo: 401,
      solicitante: 201,
      agente: 201,
      supervisor: 201,
      admin: 201,
      pendente: 403,
    },
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
    expected: {
      anonimo: 401,
      solicitante: 404,
      agente: 404,
      supervisor: 200,
      admin: 200,
      pendente: 403,
    },
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
    expected: {
      anonimo: 401,
      solicitante: 403,
      agente: 404,
      supervisor: 200,
      admin: 200,
      pendente: 403,
    },
  },
  {
    method: 'post',
    path: (ref) => `/api/tickets/${ref.ticketId}/messages`,
    label: '/api/tickets/:id/messages (do solicitante, grupo do agente)',
    body: () => ({ kind: 'public', bodyHtml: '<p>oi</p>' }),
    expected: {
      anonimo: 401,
      solicitante: 201,
      agente: 201,
      supervisor: 201,
      admin: 201,
      pendente: 403,
    },
  },
  {
    method: 'post',
    path: (ref) => `/api/tickets/${ref.ticketId}/messages`,
    label: '/api/tickets/:id/messages (nota interna)',
    body: () => ({ kind: 'internal', bodyHtml: '<p>oi</p>' }),
    expected: {
      anonimo: 401,
      solicitante: 403,
      agente: 201,
      supervisor: 201,
      admin: 201,
      pendente: 403,
    },
  },
  {
    method: 'post',
    path: (ref) => `/api/tickets/${ref.foreignTicketId}/messages`,
    label: '/api/tickets/:id/messages (fora do escopo)',
    body: () => ({ kind: 'public', bodyHtml: '<p>oi</p>' }),
    expected: {
      anonimo: 401,
      solicitante: 404,
      agente: 404,
      supervisor: 201,
      admin: 201,
      pendente: 403,
    },
  },
  // T22: fila de liberação — só admin e supervisor.
  { method: 'get', path: '/api/users/access-requests', expected: ADMIN_OR_SUPERVISOR },
  {
    method: 'post',
    path: (ref) => `/api/users/${ref.pendingUserId}/access/approve`,
    label: '/api/users/:id/access/approve',
    body: (ref) => ({ companyId: ref.companyId, departmentId: ref.departmentId }),
    expected: ADMIN_OR_SUPERVISOR,
  },
  {
    method: 'post',
    path: (ref) => `/api/users/${ref.pendingUserId}/access/reject`,
    label: '/api/users/:id/access/reject',
    // Corpo vazio explícito: rejectAccessSchema aceita {} (note é opcional), mas sem corpo
    // nenhum o ZodValidationPipe recebe `undefined` e falha com 422 antes de chegar na role.
    body: () => ({}),
    expected: ADMIN_OR_SUPERVISOR,
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
    for (const { actor, roles, accessStatus } of ACTORS) {
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
          // T22: 'pendente' fica pending de propósito; os demais já fazem parte do sistema.
          accessStatus,
        },
      });
      userIds.set(actor, user.id);
      tokens.set(actor, await t.tokens.sign({ sub, roles }));
    }
    await t.prisma.groupMember.create({
      data: { groupId: ownGroup.id, userId: userIds.get('agente')! },
    });
    const external = await t.prisma.user.create({
      data: {
        email: 'terceiro@exemplo.com',
        name: 'Terceiro',
        isExternal: true,
        accessStatus: 'approved',
      },
    });
    const attachments = t.app.get(AttachmentsService);
    /** Ticket com uma mensagem pública que tem um anexo gravado no storage. */
    const ticket = async (requesterId: string, groupId: string) => {
      const stored = await attachments.storeFromBuffer(Buffer.from('x'), { filename: 'a.txt' });
      const created = await t.prisma.ticket.create({
        data: {
          subject: 'Matriz',
          source: 'portal',
          requesterId,
          groupId,
          categoryId: category.id,
          companyId: company.id,
          messages: {
            create: {
              authorId: requesterId,
              kind: 'public',
              via: 'portal',
              bodyHtml: '<p>x</p>',
              attachments: { create: stored },
            },
          },
        },
        select: { id: true, messages: { select: { attachments: { select: { id: true } } } } },
      });
      return { id: created.id, attachmentId: created.messages[0]!.attachments[0]!.id };
    };
    const own = await ticket(userIds.get('solicitante')!, ownGroup.id);
    const foreign = await ticket(external.id, otherGroup.id);
    // T22: pedido de acesso novo, alvo dos testes de aprovar/recusar.
    const pending = await t.prisma.user.create({
      data: {
        email: 'pendente-alvo@missaosalesiana.org.br',
        name: 'Pendente',
        accessStatus: 'pending',
      },
    });
    refs = {
      companyId: company.id,
      departmentId: department.id,
      categoryId: category.id,
      groupId: ownGroup.id,
      ticketId: own.id,
      attachmentId: own.attachmentId,
      foreignTicketId: foreign.id,
      foreignAttachmentId: foreign.attachmentId,
      pendingUserId: pending.id,
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
