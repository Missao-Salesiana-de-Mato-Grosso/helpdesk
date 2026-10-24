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
  method: 'get' | 'patch';
  path: string;
  body?: (ref: Refs) => object;
  expected: Record<Actor, number>;
}

interface Refs {
  companyId: string;
  departmentId: string;
}

const AUTHENTICATED = { anonimo: 401, solicitante: 200, agente: 200, supervisor: 200, admin: 200 };

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
    refs = { companyId: company.id, departmentId: department.id };
    for (const { actor, roles } of ACTORS) {
      const sub = `sub-${actor}`;
      await t.prisma.user.create({
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
      tokens.set(actor, await t.tokens.sign({ sub, roles }));
    }
  });

  const cases = MATRIX.flatMap((route) =>
    ALL_ACTORS.map((actor) => ({
      ...route,
      actor,
      status: route.expected[actor],
    })),
  );

  it.each(cases)(
    '$method $path como $actor → $status',
    async ({ method, path, body, actor, status }) => {
      let req = request(t.app.getHttpServer())[method](path);
      const token = tokens.get(actor);
      if (token) req = req.set('Authorization', `Bearer ${token}`);
      if (body) req = req.send(body(refs));
      await req.expect(status);
    },
  );
});
