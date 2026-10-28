// T15 (docs/discovery/05-plano-mvp.md): administração de usuários e membros de grupo.
// A matriz de papéis dessas rotas está em authorization.e2e-spec.ts; aqui, o comportamento.
import {
  ApiErrorCode,
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
