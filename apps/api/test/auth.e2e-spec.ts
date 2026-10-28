// Spec docs/specs/T04-T05-auth-jit.md: cada CT vira um teste com o mesmo identificador.
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { AllowDuringOnboarding, Roles } from '../src/auth/decorators.js';
import { UsersService } from '../src/users/users.service.js';
import {
  createTestApp,
  RESOURCE_OWNER_CLAIM,
  TEST_PROJECT_ID,
  TestTokenFactory,
  type TestApp,
} from './setup/auth.js';
import { truncateAll } from './setup/db.js';

// Rotas só de teste, para exercitar @Roles e @AllowDuringOnboarding.
@Controller('probe')
class ProbeController {
  @Get('supervisor')
  @Roles('supervisor')
  supervisor(): { ok: true } {
    return { ok: true };
  }

  @Get('agent-or-supervisor')
  @Roles('agente', 'supervisor')
  agentOrSupervisor(): { ok: true } {
    return { ok: true };
  }

  @Get('onboarding')
  @AllowDuringOnboarding()
  onboarding(): { ok: true } {
    return { ok: true };
  }
}

const PROFILE = { email: 'maria@missaosalesiana.org.br', name: 'Maria Silva', emailVerified: true };
const HOUR = 60 * 60 * 1000;

describe('auth e JIT (spec T04–T05, e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    t.setJwks(t.tokens.jwks);
    t.userinfo.fetchProfile.mockReset();
    t.userinfo.fetchProfile.mockResolvedValue(PROFILE);
    vi.restoreAllMocks();
  });

  const http = () => request(t.app.getHttpServer());
  const get = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`);

  async function reference() {
    const company = await t.prisma.company.create({ data: { name: 'Colégio Salesiano Cuiabá' } });
    const department = await t.prisma.department.create({ data: { name: 'Secretaria' } });
    return { company, department };
  }

  /** Usuário já vinculado, com onboarding feito e liberado (T22) — já fazia parte do sistema. */
  async function onboardedUser(sub = 'sub-1', extra: Record<string, unknown> = {}) {
    const { company, department } = await reference();
    const user = await t.prisma.user.create({
      data: {
        zitadelSub: sub,
        email: PROFILE.email,
        name: PROFILE.name,
        companyId: company.id,
        departmentId: department.id,
        lastLoginAt: new Date(),
        profileSyncedAt: new Date(),
        accessStatus: 'approved',
        ...extra,
      },
    });
    return { user, company, department };
  }

  describe('T04 — autenticação', () => {
    it('CT-01 rota sem @Public() e sem Authorization → 401 AUTH_MISSING + WWW-Authenticate', async () => {
      const res = await http().get('/api/me').expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        code: 'AUTH_MISSING',
        message: expect.any(String),
      });
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('CT-01 Authorization malformado → 401 AUTH_MISSING', async () => {
      const res = await http().get('/api/me').set('Authorization', 'Basic abc').expect(401);
      expect(res.body.code).toBe('AUTH_MISSING');
    });

    it('CT-02 GET /api/health sem token → 200', async () => {
      await http().get('/api/health').expect(200);
    });

    it('CT-03 token assinado com chave fora do JWKS → 401 AUTH_INVALID sem detalhes', async () => {
      const token = await t.tokens.sign({ key: await TestTokenFactory.foreignKey() });
      const res = await get('/api/me', token).expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        code: 'AUTH_INVALID',
        message: 'Token inválido ou expirado.',
      });
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('CT-04 exp 5 min no passado → 401 AUTH_INVALID', async () => {
      const res = await get('/api/me', await t.tokens.sign({ expiresIn: -300 })).expect(401);
      expect(res.body.code).toBe('AUTH_INVALID');
    });

    it('CT-05 exp 30 s no passado → 200 (tolerância)', async () => {
      await get('/api/me', await t.tokens.sign({ expiresIn: -30 })).expect(200);
    });

    it('CT-06 aud = ["outro-projeto"] → 401 AUTH_INVALID', async () => {
      const res = await get('/api/me', await t.tokens.sign({ aud: ['outro-projeto'] })).expect(401);
      expect(res.body.code).toBe('AUTH_INVALID');
    });

    it('CT-07 aud string igual ao projeto → 200', async () => {
      await get('/api/me', await t.tokens.sign({ aud: TEST_PROJECT_ID })).expect(200);
    });

    it('CT-08 iss diferente → 401 AUTH_INVALID', async () => {
      const res = await get('/api/me', await t.tokens.sign({ iss: 'http://outro.issuer' })).expect(
        401,
      );
      expect(res.body.code).toBe('AUTH_INVALID');
    });

    it('CT-09 JWKS indisponível e sem cache → 503 AUTH_UNAVAILABLE', async () => {
      t.setJwks(() => Promise.reject(new TypeError('fetch failed')));
      const res = await get('/api/me', await t.tokens.sign()).expect(503);
      expect(res.body.code).toBe('AUTH_UNAVAILABLE');
    });

    it('CT-10 roles { agente, foo } → roles = ["agente"], isAgent = true', async () => {
      const res = await get('/api/me', await t.tokens.sign({ roles: ['agente', 'foo'] })).expect(
        200,
      );
      expect(res.body.roles).toEqual(['agente']);
      expect(res.body.isAgent).toBe(true);
    });

    it('CT-11 roles como array [ { admin } ] → roles = ["admin"]', async () => {
      const token = await t.tokens.sign({
        claims: {
          [`urn:zitadel:iam:org:project:${TEST_PROJECT_ID}:roles`]: [{ admin: { 'org-1': 'x' } }],
        },
      });
      const res = await get('/api/me', token).expect(200);
      expect(res.body.roles).toEqual(['admin']);
    });

    it('CT-11 fallback para urn:zitadel:iam:org:project:roles', async () => {
      const token = await t.tokens.sign({
        claims: { 'urn:zitadel:iam:org:project:roles': { supervisor: { 'org-1': 'x' } } },
      });
      const res = await get('/api/me', token).expect(200);
      expect(res.body.roles).toEqual(['supervisor']);
    });

    it('CT-12 sem claim de roles → roles = [], isAgent = false', async () => {
      const res = await get('/api/me', await t.tokens.sign()).expect(200);
      expect(res.body.roles).toEqual([]);
      expect(res.body.isAgent).toBe(false);
    });

    it('CT-14 @Roles("supervisor") com usuário agente → 403 FORBIDDEN_ROLE', async () => {
      await onboardedUser();
      const res = await get(
        '/api/probe/supervisor',
        await t.tokens.sign({ roles: ['agente'] }),
      ).expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-14 @Roles("supervisor") com solicitante → 403 FORBIDDEN_ROLE', async () => {
      await onboardedUser();
      const res = await get('/api/probe/supervisor', await t.tokens.sign()).expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-15 @Roles("agente","supervisor") com supervisor → 200', async () => {
      await onboardedUser();
      await get(
        '/api/probe/agent-or-supervisor',
        await t.tokens.sign({ roles: ['supervisor'] }),
      ).expect(200);
    });
  });

  describe('T04 — organização (ZITADEL_ORG_ID configurado)', () => {
    let scoped: TestApp;

    beforeAll(async () => {
      scoped = await createTestApp({ env: { ZITADEL_ORG_ID: 'org-msmt' } });
    });

    afterAll(async () => {
      await scoped.app.close();
    });

    beforeEach(() => {
      scoped.userinfo.fetchProfile.mockResolvedValue(PROFILE);
    });

    it('CT-13 resourceowner:id diferente → 403 WRONG_ORGANIZATION', async () => {
      const token = await scoped.tokens.sign({ claims: { [RESOURCE_OWNER_CLAIM]: 'outra-org' } });
      const res = await request(scoped.app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.code).toBe('WRONG_ORGANIZATION');
      expect(await scoped.prisma.user.count()).toBe(0);
    });

    it('CT-13 resourceowner:id igual → 200', async () => {
      const token = await scoped.tokens.sign({ claims: { [RESOURCE_OWNER_CLAIM]: 'org-msmt' } });
      await request(scoped.app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('T05 — provisionamento JIT', () => {
    it('CT-16 sub inexistente → cria usuário sem unidade, needsOnboarding = true, userinfo 1 vez', async () => {
      const res = await get('/api/me', await t.tokens.sign({ sub: 'novo' })).expect(200);
      expect(res.body).toMatchObject({
        email: PROFILE.email,
        name: PROFILE.name,
        company: null,
        department: null,
        groups: [],
        needsOnboarding: true,
      });
      expect(t.userinfo.fetchProfile).toHaveBeenCalledTimes(1);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { zitadelSub: 'novo' } });
      expect(user).toMatchObject({ isExternal: false, active: true, companyId: null });
      expect(user.lastLoginAt).not.toBeNull();
      expect(user.profileSyncedAt).not.toBeNull();
    });

    it('CT-17 usuário do canal de e-mail (sem sub, não terceiro) → vinculado, mesmo id', async () => {
      const existing = await t.prisma.user.create({
        data: { email: 'MARIA@missaosalesiana.org.br', name: 'maria' },
      });
      const res = await get('/api/me', await t.tokens.sign({ sub: 'sub-novo' })).expect(200);
      expect(res.body.id).toBe(existing.id);
      const linked = await t.prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      expect(linked.zitadelSub).toBe('sub-novo');
      expect(linked.name).toBe(PROFILE.name);
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('CT-32 usuário do canal de e-mail e userinfo com e-mail não verificado → 403 EMAIL_NOT_VERIFIED, sem vínculo', async () => {
      const existing = await t.prisma.user.create({
        data: { email: PROFILE.email, name: 'maria' },
      });
      t.userinfo.fetchProfile.mockResolvedValue({ ...PROFILE, emailVerified: false });
      const res = await get('/api/me', await t.tokens.sign({ sub: 'sub-novo' })).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(await t.prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(
        existing,
      );
    });

    it('CT-33 e-mail não verificado sem usuário existente → cria normalmente', async () => {
      t.userinfo.fetchProfile.mockResolvedValue({ ...PROFILE, emailVerified: false });
      await get('/api/me', await t.tokens.sign({ sub: 'novo' })).expect(200);
      expect(await t.prisma.user.count({ where: { zitadelSub: 'novo' } })).toBe(1);
    });

    it('CT-34 resincronização com e-mail novo não verificado → mantém o antigo', async () => {
      const { user } = await onboardedUser('sub-1', {
        profileSyncedAt: new Date(Date.now() - 25 * HOUR),
      });
      t.userinfo.fetchProfile.mockResolvedValue({
        ...PROFILE,
        email: 'novo@missaosalesiana.org.br',
        emailVerified: false,
      });
      await get('/api/me', await t.tokens.sign()).expect(200);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
        PROFILE.email,
      );
    });

    // CT-18 (bloquear terceiro no login) foi substituído pelo CT-07 da spec T22
    // (docs/specs/T22-onboarding-liberacao.md, access-requests.e2e-spec.ts): RN-09 removeu esse
    // bloqueio — terceiro pode logar e entra na fila de liberação como qualquer pessoa.

    it('CT-19 mesmo e-mail com outro zitadel_sub → 403 WRONG_ORGANIZATION', async () => {
      await t.prisma.user.create({
        data: { email: PROFILE.email, name: 'Maria', zitadelSub: 'outro' },
      });
      const res = await get('/api/me', await t.tokens.sign({ sub: 'sub-1' })).expect(403);
      expect(res.body.code).toBe('WRONG_ORGANIZATION');
    });

    it('CT-20 userinfo falha no 1º acesso → 503 AUTH_UNAVAILABLE, nenhum usuário criado', async () => {
      t.userinfo.fetchProfile.mockRejectedValue(new Error('down'));
      const res = await get('/api/me', await t.tokens.sign()).expect(503);
      expect(res.body.code).toBe('AUTH_UNAVAILABLE');
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('CT-21 roles [] no banco, token traz agente → roles atualizadas após expirar o cache', async () => {
      const { user } = await onboardedUser();
      await get('/api/me', await t.tokens.sign()).expect(200);
      t.cache.clear();
      await get('/api/me', await t.tokens.sign({ roles: ['agente'] })).expect(200);
      const updated = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(updated.roles).toEqual(['agente']);
    });

    it('CT-22 profile_synced_at há 25 h → nome atualizado, userinfo 1 vez', async () => {
      const { user } = await onboardedUser('sub-1', {
        profileSyncedAt: new Date(Date.now() - 25 * HOUR),
      });
      t.userinfo.fetchProfile.mockResolvedValue({ ...PROFILE, name: 'Maria S. Souza' });
      const res = await get('/api/me', await t.tokens.sign()).expect(200);
      expect(res.body.name).toBe('Maria S. Souza');
      expect(t.userinfo.fetchProfile).toHaveBeenCalledTimes(1);
      const updated = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(updated.profileSyncedAt!.getTime()).toBeGreaterThan(Date.now() - HOUR);
    });

    it('CT-22 perfil sincronizado há menos de 24 h → userinfo não é chamado', async () => {
      await onboardedUser();
      await get('/api/me', await t.tokens.sign()).expect(200);
      expect(t.userinfo.fetchProfile).not.toHaveBeenCalled();
    });

    it('CT-23 resincronização com userinfo falhando → 200, nome antigo mantido', async () => {
      const { user } = await onboardedUser('sub-1', {
        profileSyncedAt: new Date(Date.now() - 25 * HOUR),
      });
      t.userinfo.fetchProfile.mockRejectedValue(new Error('down'));
      const res = await get('/api/me', await t.tokens.sign()).expect(200);
      expect(res.body.name).toBe(PROFILE.name);
      const after = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.name).toBe(PROFILE.name);
      expect(after.profileSyncedAt!.getTime()).toBeLessThan(Date.now() - 24 * HOUR);
    });

    it('CT-23 novo e-mail colidindo com outro usuário → mantém o antigo', async () => {
      const { user } = await onboardedUser('sub-1', {
        profileSyncedAt: new Date(Date.now() - 25 * HOUR),
      });
      await t.prisma.user.create({
        data: { email: 'outro@missaosalesiana.org.br', name: 'Outro' },
      });
      t.userinfo.fetchProfile.mockResolvedValue({
        ...PROFILE,
        email: 'outro@missaosalesiana.org.br',
      });
      await get('/api/me', await t.tokens.sign()).expect(200);
      const after = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe(PROFILE.email);
    });

    it('CT-24 dois requests do mesmo sub dentro do TTL → banco consultado 1 vez', async () => {
      await onboardedUser();
      const spy = vi.spyOn(t.app.get(UsersService), 'findBySub');
      const token = await t.tokens.sign();
      await get('/api/probe/onboarding', token).expect(200);
      await get('/api/probe/onboarding', token).expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('CT-25 usuário active = false → 403 USER_INACTIVE', async () => {
      await onboardedUser('sub-1', { active: false });
      const res = await get('/api/me', await t.tokens.sign()).expect(403);
      expect(res.body.code).toBe('USER_INACTIVE');
    });
  });

  describe('T05 — onboarding e /me', () => {
    it('CT-26 usuário sem unidade → GET /api/tickets 403 ONBOARDING_REQUIRED', async () => {
      const res = await get('/api/tickets', await t.tokens.sign({ roles: ['admin'] })).expect(403);
      expect(res.body.code).toBe('ONBOARDING_REQUIRED');
    });

    it('CT-27 usuário sem unidade → GET /api/companies 200, só ativas, por nome', async () => {
      await t.prisma.company.createMany({
        data: [{ name: 'Sede' }, { name: 'Antiga', active: false }, { name: 'Colégio Dom Bosco' }],
      });
      const res = await get('/api/companies', await t.tokens.sign()).expect(200);
      expect(res.body.map((c: { name: string }) => c.name)).toEqual(['Colégio Dom Bosco', 'Sede']);
      expect(Object.keys(res.body[0]).toSorted()).toEqual(['id', 'name']);
    });

    it('CT-27 usuário sem unidade → GET /api/departments 200', async () => {
      await t.prisma.department.create({ data: { name: 'Secretaria' } });
      const res = await get('/api/departments', await t.tokens.sign()).expect(200);
      expect(res.body).toEqual([{ id: expect.any(String), name: 'Secretaria' }]);
    });

    it('CT-28 PATCH /api/me com unidade e departamento ativos → 200 e libera o resto da API', async () => {
      // T22: só o onboarding não libera mais quem nunca teve role (fica pending até um admin
      // aprovar) — aqui o token já traz "agente", que a RN-04 aprova sozinho, para isolar o que
      // esta CT testa (o gate de onboarding, não o de liberação de acesso).
      const { company, department } = await reference();
      const token = await t.tokens.sign({ roles: ['agente'] });
      await get('/api/tickets', token).expect(403);
      const res = await http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyId: company.id, departmentId: department.id })
        .expect(200);
      expect(res.body).toMatchObject({
        needsOnboarding: false,
        company: { id: company.id, name: company.name },
        department: { id: department.id, name: department.name },
      });
      await get('/api/tickets', token).expect(200);
    });

    it('CT-29 PATCH /api/me com departamento inativo → 422 VALIDATION_ERROR', async () => {
      const { company } = await reference();
      const inactive = await t.prisma.department.create({
        data: { name: 'Extinto', active: false },
      });
      const res = await http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${await t.tokens.sign()}`)
        .send({ companyId: company.id, departmentId: inactive.id })
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('CT-29 PATCH /api/me com unidade inexistente → 422 VALIDATION_ERROR', async () => {
      const { department } = await reference();
      const res = await http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${await t.tokens.sign()}`)
        .send({ companyId: '00000000-0000-4000-8000-000000000000', departmentId: department.id })
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('CT-30 PATCH /api/me com campo extra name → 422 VALIDATION_ERROR', async () => {
      const { company, department } = await reference();
      const res = await http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${await t.tokens.sign()}`)
        .send({ companyId: company.id, departmentId: department.id, name: 'Outro' })
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('CT-31 agente com 2 grupos → groups com os 2, company e department preenchidos', async () => {
      const { user, company, department } = await onboardedUser();
      const g1 = await t.prisma.group.create({ data: { name: 'Suporte TI' } });
      const g2 = await t.prisma.group.create({ data: { name: 'Sistemas' } });
      await t.prisma.groupMember.createMany({
        data: [
          { groupId: g1.id, userId: user.id },
          { groupId: g2.id, userId: user.id },
        ],
      });
      const res = await get('/api/me', await t.tokens.sign({ roles: ['agente'] })).expect(200);
      expect(res.body).toEqual({
        id: user.id,
        name: PROFILE.name,
        email: PROFILE.email,
        roles: ['agente'],
        isAgent: true,
        company: { id: company.id, name: company.name },
        department: { id: department.id, name: department.name },
        groups: [
          { id: g2.id, name: 'Sistemas' },
          { id: g1.id, name: 'Suporte TI' },
        ],
        needsOnboarding: false,
        accessStatus: 'approved',
      });
    });
  });
});
