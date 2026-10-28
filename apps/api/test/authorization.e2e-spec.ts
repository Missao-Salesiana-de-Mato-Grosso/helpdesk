// Matriz de permissões (01-escopo, T19): toda rota da API × cada papel. Toda rota nova entra aqui;
// o teste "toda rota registrada está na matriz" falha se faltar alguma.
// Os usuários já passaram pelo 1º acesso; o bloqueio de onboarding é coberto em auth.e2e-spec.ts.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TicketDetail, TicketListResponse } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { InboundEmailService } from '../src/inbound-email/inbound-email.service.js';
import { E2E_INBOX_PATH } from '../vitest.config.e2e.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';

// Corpo da resposta tipado pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const detailOf = (res: Response) => res.body as TicketDetail;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as TicketListResponse;

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
  method: 'get' | 'patch' | 'post' | 'delete';
  /** Pode depender dos dados criados no beforeEach (ex.: id de um ticket). */
  path: string | ((ref: Refs) => string);
  /** Rota como o Nest a registra (`/api/tickets/:id`). Obrigatória quando `path` é uma função. */
  template?: string;
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
  /** Pedido na lixeira, sem ticket (T22: restaurar e excluir). */
  trashedUserId: string;
  /** Usuário do papel `solicitante` (alvo de "abrir em nome de outro"). */
  requesterUserId: string;
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

/** Lixeira (T22): só admin. */
const ADMIN_ONLY = {
  anonimo: 401,
  solicitante: 403,
  agente: 403,
  supervisor: 403,
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
    template: '/api/attachments/:id',
    expected: AUTHENTICATED,
  },
  {
    method: 'get',
    path: (ref) => `/api/attachments/${ref.foreignAttachmentId}`,
    label: '/api/attachments/:id (fora do escopo)',
    template: '/api/attachments/:id',
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
    template: '/api/groups/:id/members',
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
    template: '/api/tickets/:id',
    expected: AUTHENTICATED,
  },
  {
    // Fora do escopo → 404 (não 403), para não revelar a existência.
    method: 'get',
    path: (ref) => `/api/tickets/${ref.foreignTicketId}`,
    label: '/api/tickets/:id (fora do escopo)',
    template: '/api/tickets/:id',
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
    template: '/api/tickets/:id',
    body: () => ({ version: 1, priority: 'high' }),
    expected: AGENT_ONLY,
  },
  {
    method: 'patch',
    path: (ref) => `/api/tickets/${ref.foreignTicketId}`,
    label: 'PATCH /api/tickets/:id (fora do escopo)',
    template: '/api/tickets/:id',
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
    template: '/api/tickets/:id/messages',
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
    template: '/api/tickets/:id/messages',
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
    template: '/api/tickets/:id/messages',
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
    template: '/api/users/:id/access/approve',
    body: (ref) => ({ companyId: ref.companyId, departmentId: ref.departmentId }),
    expected: ADMIN_OR_SUPERVISOR,
  },
  {
    method: 'post',
    path: (ref) => `/api/users/${ref.pendingUserId}/access/reject`,
    label: '/api/users/:id/access/reject',
    template: '/api/users/:id/access/reject',
    // Corpo vazio explícito: rejectAccessSchema aceita {} (note é opcional), mas sem corpo
    // nenhum o ZodValidationPipe recebe `undefined` e falha com 422 antes de chegar na role.
    body: () => ({}),
    expected: ADMIN_OR_SUPERVISOR,
  },
  {
    method: 'post',
    path: (ref) => `/api/users/${ref.trashedUserId}/access/restore`,
    template: '/api/users/:id/access/restore',
    label: '/api/users/:id/access/restore',
    expected: ADMIN_OR_SUPERVISOR,
  },
  {
    method: 'delete',
    path: (ref) => `/api/users/${ref.trashedUserId}/access/trash`,
    template: '/api/users/:id/access/trash',
    label: '/api/users/:id/access/trash',
    expected: { ...ADMIN_ONLY, admin: 204 },
  },
  { method: 'delete', path: '/api/users/access-requests/trash', expected: ADMIN_ONLY },
];

/** Rotas que o Express tem registradas, no formato `GET /api/tickets/:id`. */
function registeredRoutes(app: INestApplication): string[] {
  // A instância do Express não é tipada pelo Nest; só o `router.stack` é lido.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const express = app.getHttpAdapter().getInstance() as {
    router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  // Middlewares de módulo (ex.: o log do nestjs-pino) entram como `/api{/*splat}` em todos os
  // métodos; nenhum controller usa curinga, então rotas com `*` ficam de fora.
  return express.router.stack.flatMap(({ route }) =>
    route && !route.path.includes('*')
      ? Object.keys(route.methods)
          .filter((method) => method !== '_all')
          .map((method) => `${method.toUpperCase()} ${route.path}`)
      : [],
  );
}

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
    const trashed = await t.prisma.user.create({
      data: {
        email: 'lixeira@exemplo.com',
        name: 'Na lixeira',
        accessStatus: 'trashed',
        trashedAt: new Date(),
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
      trashedUserId: trashed.id,
      requesterUserId: userIds.get('solicitante')!,
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

  it('toda rota registrada está na matriz (T19: rota nova sem linha aqui → falha)', () => {
    const covered = new Set(
      MATRIX.map((route) => {
        const template = typeof route.path === 'string' ? route.path : route.template;
        if (!template) throw new Error(`Falta "template" em ${route.label ?? '?'}`);
        return `${route.method.toUpperCase()} ${template}`;
      }),
    );
    const routes = registeredRoutes(t.app);
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.filter((route) => !covered.has(route))).toEqual([]);
  });

  const call = (actor: Actor, method: RouteCase['method'], url: string) => {
    const req = request(t.app.getHttpServer())[method](url);
    const token = tokens.get(actor);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const agentUser = () =>
    t.prisma.user.findFirstOrThrow({ where: { email: 'agente@missaosalesiana.org.br' } });
  const addInternalNote = async () =>
    t.prisma.ticketMessage.create({
      data: {
        ticketId: refs.ticketId,
        authorId: (await agentUser()).id,
        kind: 'internal',
        via: 'portal',
        bodyHtml: '<p>nota</p>',
      },
    });

  // Linhas da "Matriz de permissões" de 01-escopo que dependem do conteúdo da resposta, não só do
  // status HTTP.
  describe('linhas da matriz por papel', () => {
    it.each([
      { actor: 'solicitante' as const, seesInternal: false },
      { actor: 'agente' as const, seesInternal: true },
      { actor: 'supervisor' as const, seesInternal: true },
      { actor: 'admin' as const, seesInternal: true },
    ])('Ver notas internas: $actor → $seesInternal', async ({ actor, seesInternal }) => {
      await addInternalNote();
      const res = await call(actor, 'get', `/api/tickets/${refs.ticketId}`).expect(200);
      const kinds = detailOf(res).messages.map((message) => message.kind);
      expect(kinds.includes('internal')).toBe(seesInternal);
    });

    it.each([
      { actor: 'solicitante' as const, query: '', sees: ['own'] },
      { actor: 'agente' as const, query: '?view=all', sees: ['own'] },
      { actor: 'supervisor' as const, query: '?view=all', sees: ['foreign', 'own'] },
      { actor: 'admin' as const, query: '?view=all', sees: ['foreign', 'own'] },
    ])(
      'Ver próprios / dos grupos / todos: $actor$query → $sees',
      async ({ actor, query, sees }) => {
        const res = await call(actor, 'get', `/api/tickets${query}`).expect(200);
        const names: Record<string, string> = {
          [refs.ticketId]: 'own',
          [refs.foreignTicketId]: 'foreign',
        };
        const visible = listOf(res).items.map((item) => names[item.id] ?? item.id);
        expect(visible.toSorted()).toEqual(sees);
      },
    );

    it('Ver todos os tickets: a visão "all" é só para agentes (solicitante → 403)', async () => {
      await call('solicitante', 'get', '/api/tickets?view=all').expect(403);
    });

    it.each([
      { actor: 'solicitante' as const, status: 403 },
      { actor: 'agente' as const, status: 201 },
      { actor: 'supervisor' as const, status: 201 },
      { actor: 'admin' as const, status: 201 },
    ])('Abrir ticket em nome de outro: $actor → $status', async ({ actor, status }) => {
      // O solicitante tenta abrir em nome do agente; os demais, em nome do solicitante.
      const requesterId = actor === 'solicitante' ? (await agentUser()).id : refs.requesterUserId;
      const res = await call(actor, 'post', '/api/tickets')
        .send({
          subject: 'Em nome',
          bodyHtml: '<p>x</p>',
          categoryId: refs.categoryId,
          requesterId,
        })
        .expect(status);
      if (status === 201) {
        const created = await t.prisma.ticket.findUniqueOrThrow({
          where: { id: detailOf(res).id },
        });
        expect(created.requesterId).toBe(requesterId);
      }
    });
  });

  // Canal de e-mail (T21) × liberação (T22, ADR-011): o terceiro pode logar, mas fica pendente.
  describe('canal de e-mail', () => {
    let counter = 0;
    const drop = async (from: string, subject: string, body: string) => {
      counter += 1;
      const raw = [
        `From: ${from}`,
        'To: suporte@missaosalesiana.org.br',
        `Subject: ${subject}`,
        'Date: Sat, 24 Oct 2026 12:00:00 -0400',
        `Message-ID: <matriz-${counter}-${Date.now()}@teste.org>`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        body,
        '',
      ].join('\n');
      await writeFile(join(E2E_INBOX_PATH, `${String(counter).padStart(4, '0')}.eml`), raw);
    };

    beforeEach(async () => {
      await rm(E2E_INBOX_PATH, { recursive: true, force: true });
      await mkdir(E2E_INBOX_PATH, { recursive: true });
    });

    afterAll(async () => {
      await rm(E2E_INBOX_PATH, { recursive: true, force: true });
    });

    it('terceiro que só usou o e-mail: ao logar fica pendente e não vê nem o próprio ticket', async () => {
      await drop('Fulano <fulano@externo.com>', 'Impressora', 'Não imprime');
      await t.app.get(InboundEmailService).pollMailbox();
      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'fulano@externo.com' },
      });
      expect(user).toMatchObject({ isExternal: true, accessStatus: 'pending', zitadelSub: null });
      const ticket = await t.prisma.ticket.findFirstOrThrow({ where: { requesterId: user.id } });

      t.userinfo.fetchProfile.mockResolvedValue({
        email: 'fulano@externo.com',
        name: 'Fulano',
        emailVerified: true,
      });
      const token = `Bearer ${await t.tokens.sign({ sub: 'sub-fulano' })}`;
      const http = request(t.app.getHttpServer());
      const me = await http.get('/api/me').set('Authorization', token).expect(200);
      expect(me.body).toMatchObject({ id: user.id, accessStatus: 'pending' });
      await http.get('/api/tickets').set('Authorization', token).expect(403);
      await http.get(`/api/tickets/${ticket.id}`).set('Authorization', token).expect(403);
    });

    it('resposta do solicitante por e-mail entra como pública e não expõe a nota interna', async () => {
      await addInternalNote();
      const { number } = await t.prisma.ticket.findUniqueOrThrow({ where: { id: refs.ticketId } });
      await drop(
        'solicitante@missaosalesiana.org.br',
        `Re: [#${number}] Matriz`,
        'Segue a resposta',
      );
      await t.app.get(InboundEmailService).pollMailbox();

      const fromEmail = await t.prisma.ticketMessage.findMany({
        where: { ticketId: refs.ticketId, via: 'email' },
      });
      expect(fromEmail).toHaveLength(1);
      expect(fromEmail[0]).toMatchObject({ kind: 'public', authorId: refs.requesterUserId });

      const res = await call('solicitante', 'get', `/api/tickets/${refs.ticketId}`).expect(200);
      expect(detailOf(res).messages.map((message) => message.kind)).not.toContain('internal');
    });
  });
});
