// T15 (docs/discovery/05-plano-mvp.md): administração de usuários e membros de grupo.
// T24 (ADR-012): papéis concedidos pela tela de usuários, somados aos do Zitadel.
// A matriz de papéis dessas rotas está em authorization.e2e-spec.ts; aqui, o comportamento.
import {
  ApiErrorCode,
  type MeResponse,
  type NamedRef,
  type UserListResponse,
  type UserSummary,
} from '@helpdesk/shared';
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
const listOf = (res: Response) => res.body as UserListResponse;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const userOf = (res: Response) => res.body as UserSummary;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const refsOf = (res: Response) => res.body as NamedRef[];
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const meOf = (res: Response) => res.body as MeResponse;
const names = (res: Response) => listOf(res).items.map((item) => item.name);

describe('administração de usuários e grupos — T15 (e2e)', () => {
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
  });

  const http = () => request(t.app.getHttpServer());
  const as = async (user: Login) => `Bearer ${await f.token(user)}`;
  /** Token sem roles para um `sub` qualquer. */
  const bearer = async (sub: string) => `Bearer ${await t.tokens.sign({ sub })}`;
  const get = async (user: Login, path: string) =>
    http()
      .get(path)
      .set('Authorization', await as(user));
  const patch = async (user: Login, path: string, body: object) =>
    http()
      .patch(path)
      .set('Authorization', await as(user))
      .send(body);
  const put = async (user: Login, path: string, body: object) =>
    http()
      .put(path)
      .set('Authorization', await as(user))
      .send(body);

  describe('GET /api/users', () => {
    it('searches name and e-mail without case, in alphabetical order', async () => {
      expect(names(await get('adm', '/api/users?q=AG'))).toEqual(['ag1', 'ag2']);
      const byEmail = await get('adm', '/api/users?q=missaosalesiana&pageSize=3');
      expect(listOf(byEmail)).toMatchObject({ total: 7, page: 1, pageSize: 3 });
      expect(names(byEmail)).toEqual(['adm', 'ag1', 'ag2']);
    });

    it('leaves the access-request trash out', async () => {
      await t.prisma.user.create({
        data: {
          email: 'lixo@exemplo.com',
          name: 'Lixo',
          accessStatus: 'trashed',
          trashedAt: new Date(),
        },
      });
      await t.prisma.user.create({
        data: { email: 'pendente@exemplo.com', name: 'Pendente', accessStatus: 'pending' },
      });
      expect(names(await get('adm', '/api/users?q=exemplo'))).toEqual(['Pendente']);
    });

    it('role=agent lists only who has a support role', async () => {
      expect(names(await get('adm', '/api/users?role=agent'))).toEqual([
        'adm',
        'ag1',
        'ag2',
        'sup',
      ]);
    });

    it('returns roles, unit, department and groups', async () => {
      const [ag1] = listOf(await get('adm', '/api/users?q=ag1')).items;
      expect(ag1).toMatchObject({
        id: f.users.ag1,
        email: 'ag1@missaosalesiana.org.br',
        roles: ['agente'],
        company: { id: f.U1, name: 'Unidade 1' },
        department: { id: f.D1, name: 'Secretaria' },
        groups: [{ id: f.G1, name: 'Grupo 1' }],
        isExternal: false,
        active: true,
        accessStatus: 'approved',
      });
    });

    it('rejects unknown query parameters with 422', async () => {
      expect((await get('adm', '/api/users?status=trashed')).status).toBe(422);
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('updates unit, department and the third-party flag', async () => {
      const D2 = await t.prisma.department.create({ data: { name: 'Financeiro' } });
      const res = await patch('adm', `/api/users/${f.users.req1}`, {
        companyId: f.U2,
        departmentId: D2.id,
        isExternal: true,
      });
      expect(res.status).toBe(200);
      expect(userOf(res)).toMatchObject({
        company: { id: f.U2 },
        department: { id: D2.id },
        isExternal: true,
      });
      const saved = await t.prisma.user.findUniqueOrThrow({ where: { id: f.users.req1 } });
      expect(saved).toMatchObject({ companyId: f.U2, departmentId: D2.id, isExternal: true });
    });

    it('rejects an inactive unit or department with 422 INACTIVE_REFERENCE', async () => {
      const closed = await t.prisma.company.create({ data: { name: 'Fechada', active: false } });
      const res = await patch('adm', `/api/users/${f.users.req1}`, { companyId: closed.id });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiErrorCode.INACTIVE_REFERENCE);
    });

    it('answers 404 for an unknown or malformed id', async () => {
      expect(
        (await patch('adm', '/api/users/00000000-0000-4000-8000-000000000000', { active: true }))
          .status,
      ).toBe(404);
      expect((await patch('adm', '/api/users/nao-e-uuid', { active: true })).status).toBe(404);
    });

    it('rejects an empty body and fields that are not editable (roles come from Zitadel)', async () => {
      expect((await patch('adm', `/api/users/${f.users.req1}`, {})).status).toBe(422);
      expect((await patch('adm', `/api/users/${f.users.req1}`, { roles: ['admin'] })).status).toBe(
        422,
      );
    });

    it('does not let the admin deactivate their own account', async () => {
      const res = await patch('adm', `/api/users/${f.users.adm}`, { active: false });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiErrorCode.CANNOT_DEACTIVATE_SELF);
    });

    it('deactivation takes effect on the next request, without waiting for the cache', async () => {
      expect((await get('ag1', '/api/me')).status).toBe(200);
      expect((await patch('adm', `/api/users/${f.users.ag1}`, { active: false })).status).toBe(200);
      const res = await get('ag1', '/api/tickets');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ApiErrorCode.USER_INACTIVE);
    });
  });

  describe('PATCH /api/users/:id — papéis concedidos no app (T24)', () => {
    it('grants admin to an agent right away, without a new token', async () => {
      expect((await get('ag1', '/api/users')).status).toBe(403);

      const res = await patch('adm', `/api/users/${f.users.ag1}`, { appRoles: ['admin'] });
      expect(res.status).toBe(200);
      expect(userOf(res)).toMatchObject({
        roles: ['admin', 'agente'],
        zitadelRoles: ['agente'],
        appRoles: ['admin'],
      });

      expect((await get('ag1', '/api/users')).status).toBe(200);
      expect(meOf(await get('ag1', '/api/me')).roles).toEqual(['admin', 'agente']);
    });

    it('revoking an app role takes effect on the next request', async () => {
      await patch('adm', `/api/users/${f.users.ag1}`, { appRoles: ['admin'] });
      expect((await get('ag1', '/api/users')).status).toBe(200);
      expect((await patch('adm', `/api/users/${f.users.ag1}`, { appRoles: [] })).status).toBe(200);
      expect((await get('ag1', '/api/users')).status).toBe(403);
    });

    it('cannot remove a role that comes from Zitadel', async () => {
      const res = await patch('adm', `/api/users/${f.users.ag2}`, { appRoles: [] });
      expect(res.status).toBe(200);
      expect(userOf(res)).toMatchObject({ roles: ['agente'], appRoles: [] });
    });

    it('turns a requester into an agent: listed as agent, joins a group, sees its tickets', async () => {
      const ticket = await f.ticket({ requester: 'req2', group: 'G1' });
      expect((await get('req1', `/api/tickets/${ticket.id}`)).status).toBe(404);

      await patch('adm', `/api/users/${f.users.req1}`, { appRoles: ['agente'] });
      expect(names(await get('adm', '/api/users?role=agent'))).toContain('req1');
      const members = await put('adm', `/api/groups/${f.G1}/members`, {
        userIds: [f.users.ag1, f.users.req1],
      });
      expect(members.status).toBe(200);
      expect((await get('req1', `/api/tickets/${ticket.id}`)).status).toBe(200);
    });

    it('does not let the admin remove their own admin role', async () => {
      await patch('adm', `/api/users/${f.users.ag1}`, { appRoles: ['admin'] });
      const res = await patch('ag1', `/api/users/${f.users.ag1}`, { appRoles: [] });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ApiErrorCode.CANNOT_DEMOTE_SELF);
      expect(
        (await patch('ag1', `/api/users/${f.users.ag1}`, { appRoles: ['admin', 'supervisor'] }))
          .status,
      ).toBe(200);
      // O admin do Zitadel continua admin mesmo sem papel no app.
      expect((await patch('adm', `/api/users/${f.users.adm}`, { appRoles: [] })).status).toBe(200);
    });

    it('granting a role to a pending user releases the access (RN-04)', async () => {
      const pending = await t.prisma.user.create({
        data: {
          email: 'novo@missaosalesiana.org.br',
          name: 'Novo',
          zitadelSub: 'sub-novo',
          companyId: f.U1,
          departmentId: f.D1,
          accessStatus: 'pending',
          accessRequestedAt: new Date(),
          lastLoginAt: new Date(),
          profileSyncedAt: new Date(),
        },
      });
      const denied = await http()
        .get('/api/tickets')
        .set('Authorization', await bearer('sub-novo'));
      expect(denied.status).toBe(403);

      const res = await patch('adm', `/api/users/${pending.id}`, { appRoles: ['agente'] });
      expect(userOf(res).accessStatus).toBe('approved');
      const saved = await t.prisma.user.findUniqueOrThrow({ where: { id: pending.id } });
      expect(saved.accessDecidedById).toBe(f.users.adm);

      const allowed = await http()
        .get('/api/tickets')
        .set('Authorization', await bearer('sub-novo'));
      expect(allowed.status).toBe(200);
    });

    it('keeps app roles when the Zitadel roles in the token change', async () => {
      await patch('adm', `/api/users/${f.users.ag1}`, { appRoles: ['supervisor'] });
      // Token sem nenhuma role: o agente perdeu o papel no Zitadel.
      const me = await http()
        .get('/api/me')
        .set('Authorization', await bearer('sub-ag1'));
      expect(meOf(me).roles).toEqual(['supervisor']);
      const saved = await t.prisma.user.findUniqueOrThrow({ where: { id: f.users.ag1 } });
      expect(saved).toMatchObject({
        zitadelRoles: [],
        appRoles: ['supervisor'],
        roles: ['supervisor'],
      });
    });
  });

  describe('PUT /api/groups/:id/members', () => {
    it('replaces the members and changes the ticket scope right away', async () => {
      const ticket = await f.ticket({ requester: 'req1', group: 'G1' });
      // Aquece o cache dos dois agentes com os grupos antigos.
      expect((await get('ag1', `/api/tickets/${ticket.id}`)).status).toBe(200);
      expect((await get('ag2', `/api/tickets/${ticket.id}`)).status).toBe(404);

      const res = await put('adm', `/api/groups/${f.G1}/members`, { userIds: [f.users.ag2] });
      expect(res.status).toBe(200);
      expect(refsOf(res)).toEqual([{ id: f.users.ag2, name: 'ag2' }]);

      expect((await get('ag2', `/api/tickets/${ticket.id}`)).status).toBe(200);
      expect((await get('ag1', `/api/tickets/${ticket.id}`)).status).toBe(404);
    });

    it('accepts an empty list and repeated ids', async () => {
      expect(
        (await put('adm', `/api/groups/${f.G1}/members`, { userIds: [f.users.ag2, f.users.ag2] }))
          .status,
      ).toBe(200);
      const emptied = await put('adm', `/api/groups/${f.G1}/members`, { userIds: [] });
      expect(refsOf(emptied)).toEqual([]);
    });

    it('rejects requesters, inactive agents and unknown users with 422 NOT_AN_AGENT', async () => {
      await t.prisma.user.update({ where: { id: f.users.ag2 }, data: { active: false } });
      const unknown = '00000000-0000-4000-8000-000000000000';
      const res = await put('adm', `/api/groups/${f.G1}/members`, {
        userIds: [f.users.ag1, f.users.req1, f.users.ag2, unknown],
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: ApiErrorCode.NOT_AN_AGENT,
        userIds: [f.users.req1, f.users.ag2, unknown],
      });
      // Nada mudou.
      const members = await t.prisma.groupMember.findMany({ where: { groupId: f.G1 } });
      expect(members.map((member) => member.userId)).toEqual([f.users.ag1]);
    });

    it('answers 404 for an unknown group', async () => {
      const res = await put('adm', '/api/groups/00000000-0000-4000-8000-000000000000/members', {
        userIds: [],
      });
      expect(res.status).toBe(404);
    });

    it('an agent can list the members of a group to assign tickets (acceptance)', async () => {
      const res = await get('ag1', `/api/groups/${f.G2}/members`);
      expect(res.status).toBe(200);
      expect(refsOf(res)).toEqual([{ id: f.users.ag2, name: 'ag2' }]);
    });
  });
});
