// Spec docs/specs/T22-onboarding-liberacao.md: cada CT vira um teste com o mesmo identificador.
// RN-21 a RN-26 (cadastro próprio sem Google) ficam fora desta rodada — dependem da P13
// (SMTP do Zitadel), ainda aberta em docs/ambientes.md. CT-21, CT-22 e CT-26 não entram aqui.
import request from 'supertest';
import { UsersService } from '../src/users/users.service.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';

const PROFILE = { email: 'maria@missaosalesiana.org.br', name: 'Maria Silva', emailVerified: true };
const DAY_MS = 24 * 60 * 60 * 1000;

describe('liberação de acesso (spec T22, e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    t.userinfo.fetchProfile.mockReset();
    t.userinfo.fetchProfile.mockResolvedValue(PROFILE);
    vi.restoreAllMocks();
  });

  const http = () => request(t.app.getHttpServer());
  const get = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string) =>
    http().post(path).set('Authorization', `Bearer ${token}`);

  async function reference() {
    const company = await t.prisma.company.create({ data: { name: 'Colégio Salesiano Cuiabá' } });
    const department = await t.prisma.department.create({ data: { name: 'Secretaria' } });
    return { company, department };
  }

  async function pendingUser(email: string, extra: Record<string, unknown> = {}) {
    return t.prisma.user.create({
      data: { email, name: email.split('@')[0]!, accessStatus: 'pending', ...extra },
    });
  }

  // Idempotente: alguns testes chamam mais de uma vez (ex.: aprovar e depois recusar outro pedido).
  async function adminToken() {
    const existing = await t.prisma.user.findUnique({ where: { zitadelSub: 'sub-admin' } });
    if (!existing) {
      // Unidade/departamento próprios do fixture: `reference()` é chamado por vários testes para
      // o próprio cenário, e Company.name é único — não dá para reaproveitar o mesmo nome aqui.
      const company = await t.prisma.company.create({ data: { name: 'Sede (admin, fixture)' } });
      const department = await t.prisma.department.create({
        data: { name: 'TI (admin, fixture)' },
      });
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-admin',
          email: 'admin@missaosalesiana.org.br',
          name: 'Admin',
          roles: ['admin'],
          accessStatus: 'approved',
          companyId: company.id,
          departmentId: department.id,
        },
      });
    }
    return t.tokens.sign({ sub: 'sub-admin', roles: ['admin'] });
  }

  describe('RN-02 a RN-06: estado novo e bloqueio', () => {
    it('CT-02 1º login (sub novo, sem role) → usuário criado pending', async () => {
      await get('/api/me', await t.tokens.sign({ sub: 'novo' })).expect(200);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { zitadelSub: 'novo' } });
      expect(user.accessStatus).toBe('pending');
    });

    it('CT-03 pending em /api/tickets → 403 ACCESS_PENDING', async () => {
      // Unidade e departamento já preenchidos: isola o bloqueio de acesso do de onboarding
      // (RN-05 dá prioridade ao onboarding — coberto em auth.e2e-spec.ts).
      const { company, department } = await reference();
      await t.prisma.user.create({
        data: {
          zitadelSub: 'novo',
          email: PROFILE.email,
          name: PROFILE.name,
          companyId: company.id,
          departmentId: department.id,
          accessStatus: 'pending',
        },
      });
      const token = await t.tokens.sign({ sub: 'novo' });
      const res = await get('/api/me', token).expect(200);
      expect(res.body.accessStatus).toBe('pending');
      const ticketsRes = await get('/api/tickets', token).expect(403);
      expect(ticketsRes.body.code).toBe('ACCESS_PENDING');
    });

    it('CT-04 pending em /api/me e /api/companies → 200', async () => {
      const token = await t.tokens.sign({ sub: 'novo' });
      await get('/api/me', token).expect(200);
      await get('/api/companies', token).expect(200);
      await get('/api/departments', token).expect(200);
    });

    it('CT-05 rejected → 403 ACCESS_REJECTED; GET /me 200 com accessStatus=rejected', async () => {
      // GET /companies é isento mesmo para rejected (RN-06): usa /tickets para testar o bloqueio.
      const { company, department } = await reference();
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-r',
          email: PROFILE.email,
          name: 'Maria',
          companyId: company.id,
          departmentId: department.id,
          accessStatus: 'rejected',
        },
      });
      const token = await t.tokens.sign({ sub: 'sub-r' });
      const me = await get('/api/me', token).expect(200);
      expect(me.body.accessStatus).toBe('rejected');
      const res = await get('/api/tickets', token).expect(403);
      expect(res.body.code).toBe('ACCESS_REJECTED');
    });

    it('CT-06 pending com role agente no token → libera e fica approved, com log', async () => {
      const { company, department } = await reference();
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-ag',
          email: PROFILE.email,
          name: 'Maria',
          companyId: company.id,
          departmentId: department.id,
          accessStatus: 'pending',
        },
      });
      await get('/api/tickets', await t.tokens.sign({ sub: 'sub-ag', roles: ['agente'] })).expect(
        200,
      );
      const updated = await t.prisma.user.findUniqueOrThrow({ where: { zitadelSub: 'sub-ag' } });
      expect(updated.accessStatus).toBe('approved');
      expect(updated.accessDecidedById).toBeNull();
    });
  });

  it('CT-07 usuário criado pelo e-mail com is_external = true → vinculado, pending, sem bloqueio', async () => {
    const existing = await t.prisma.user.create({
      data: { email: PROFILE.email, name: 'Terceiro', isExternal: true, accessStatus: 'pending' },
    });
    const res = await get('/api/me', await t.tokens.sign({ sub: 'sub-novo' })).expect(200);
    expect(res.body.id).toBe(existing.id);
    expect(res.body.accessStatus).toBe('pending');
    const linked = await t.prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(linked.zitadelSub).toBe('sub-novo');
    expect(linked.accessStatus).toBe('pending');
  });

  describe('RN-10 a RN-15: fila e decisão do admin', () => {
    it('CT-08 fila ordenada do pedido mais antigo para o mais novo', async () => {
      const older = await pendingUser('mais-antigo@exemplo.com', {
        accessRequestedAt: new Date(Date.now() - 2 * DAY_MS),
      });
      const newer = await pendingUser('mais-novo@exemplo.com', {
        accessRequestedAt: new Date(Date.now() - 1 * DAY_MS),
      });
      const res = await get('/api/users/access-requests', await adminToken()).expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([older.id, newer.id]);
    });

    it('CT-09 aprova com outra unidade → approved, decisor e data gravados, cache invalidado', async () => {
      const { department } = await reference();
      const other = await t.prisma.company.create({ data: { name: 'Outra unidade' } });
      const target = await pendingUser('alvo@missaosalesiana.org.br', {
        zitadelSub: 'sub-alvo',
        accessRequestedAt: new Date(),
      });
      // Cacheia o usuário pending antes da decisão, para confirmar a invalidação (RN-15).
      await get('/api/me', await t.tokens.sign({ sub: 'sub-alvo' })).expect(200);
      const token = await adminToken();
      const res = await post(`/api/users/${target.id}/access/approve`, token)
        .send({ companyId: other.id, departmentId: department.id })
        .expect(200);
      expect(res.body.accessStatus).toBe('approved');
      expect(res.body.company.id).toBe(other.id);
      const updated = await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(updated.accessDecidedById).not.toBeNull();
      expect(updated.accessDecidedAt).not.toBeNull();
      // Se o cache não tivesse sido invalidado, esta chamada ainda veria pending.
      await get('/api/tickets', await t.tokens.sign({ sub: 'sub-alvo' })).expect(200);
    });

    it('CT-10 aprova sem departamento → 422', async () => {
      const target = await pendingUser('alvo2@missaosalesiana.org.br');
      const { company } = await reference();
      await post(`/api/users/${target.id}/access/approve`, await adminToken())
        .send({ companyId: company.id })
        .expect(422);
    });

    it('CT-11 recusa com nota → rejected; nota não aparece na resposta ao usuário', async () => {
      const target = await pendingUser('alvo3@missaosalesiana.org.br');
      const res = await post(`/api/users/${target.id}/access/reject`, await adminToken())
        .send({ note: 'E-mail não confere com o cadastro' })
        .expect(200);
      expect(res.body.accessStatus).toBe('rejected');
      expect(JSON.stringify(res.body)).not.toContain('não confere');
      const updated = await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(updated.accessNote).toBe('E-mail não confere com o cadastro');
    });

    it('CT-12 aprovar quem já está approved → 409', async () => {
      const { company, department } = await reference();
      const target = await t.prisma.user.create({
        data: { email: 'ja-aprovado@exemplo.com', name: 'X', accessStatus: 'approved' },
      });
      await post(`/api/users/${target.id}/access/approve`, await adminToken())
        .send({ companyId: company.id, departmentId: department.id })
        .expect(409);
    });

    it('CT-13 solicitante tentando aprovar → 403 FORBIDDEN_ROLE', async () => {
      const { company, department } = await reference();
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-sol',
          email: 'sol@missaosalesiana.org.br',
          name: 'Solicitante',
          companyId: company.id,
          departmentId: department.id,
          accessStatus: 'approved',
        },
      });
      const target = await pendingUser('alvo4@exemplo.com');
      const res = await post(
        `/api/users/${target.id}/access/approve`,
        await t.tokens.sign({ sub: 'sub-sol' }),
      )
        .send({ companyId: company.id, departmentId: department.id })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-20 supervisor aprova pedido pending → 200 approved', async () => {
      const { company, department } = await reference();
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-sup',
          email: 'sup@missaosalesiana.org.br',
          name: 'Supervisor',
          roles: ['supervisor'],
          companyId: company.id,
          departmentId: department.id,
          accessStatus: 'approved',
        },
      });
      const target = await pendingUser('alvo5@exemplo.com');
      const res = await post(
        `/api/users/${target.id}/access/approve`,
        await t.tokens.sign({ sub: 'sub-sup', roles: ['supervisor'] }),
      )
        .send({ companyId: company.id, departmentId: department.id })
        .expect(200);
      expect(res.body.accessStatus).toBe('approved');
    });
  });

  describe('RN-16 a RN-18: notificações sem ticket', () => {
    it('CT-14 completar o 1º acesso avisa os admins ativos; um PATCH /me seguinte não duplica', async () => {
      await t.prisma.user.create({
        data: {
          email: 'admin1@missaosalesiana.org.br',
          name: 'Admin 1',
          roles: ['admin'],
          accessStatus: 'approved',
          active: true,
        },
      });
      await t.prisma.user.create({
        data: {
          email: 'inativo@missaosalesiana.org.br',
          name: 'Admin inativo',
          roles: ['admin'],
          accessStatus: 'approved',
          active: false,
        },
      });
      const { company, department } = await reference();
      await get('/api/me', await t.tokens.sign({ sub: 'novo-sol' })).expect(200);
      await http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${await t.tokens.sign({ sub: 'novo-sol' })}`)
        .send({ companyId: company.id, departmentId: department.id })
        .expect(200);
      let count = await t.prisma.notification.count({
        where: { template: 'access_request_created' },
      });
      expect(count).toBe(1);
      const first = await t.prisma.notification.findFirstOrThrow({
        where: { template: 'access_request_created' },
      });
      expect(first.ticketId).toBeNull();
      expect(first.toEmail).toBe('admin1@missaosalesiana.org.br');

      // 2º PATCH /me (ex.: corrigindo a unidade) não gera um 2º aviso.
      await http()
        .patch('/api/me')
        .set('Authorization', `Bearer ${await t.tokens.sign({ sub: 'novo-sol' })}`)
        .send({ companyId: company.id, departmentId: department.id })
        .expect(200);
      count = await t.prisma.notification.count({ where: { template: 'access_request_created' } });
      expect(count).toBe(1);
    });

    it('CT-15 aprovar avisa o usuário sem [#n] e sem email_message_refs; recusar não avisa', async () => {
      const { company, department } = await reference();
      const approved = await pendingUser('aprovar@exemplo.com');
      await post(`/api/users/${approved.id}/access/approve`, await adminToken())
        .send({ companyId: company.id, departmentId: department.id })
        .expect(200);
      const granted = await t.prisma.notification.findFirstOrThrow({
        where: { template: 'access_granted' },
      });
      expect(granted.toEmail).toBe('aprovar@exemplo.com');
      expect(granted.ticketId).toBeNull();
      expect(await t.prisma.emailMessageRef.count()).toBe(0);

      const rejected = await pendingUser('recusar@exemplo.com');
      await post(`/api/users/${rejected.id}/access/reject`, await adminToken()).expect(200);
      expect(await t.prisma.notification.count({ where: { toEmail: 'recusar@exemplo.com' } })).toBe(
        0,
      );
    });
  });

  describe('RN-19: lixeira', () => {
    it('CT-16 cron: 31 dias pending → trashed; 29 dias não muda; rejected não vai para a lixeira', async () => {
      const old = await pendingUser('velho@exemplo.com', {
        accessRequestedAt: new Date(Date.now() - 31 * DAY_MS),
      });
      const recent = await pendingUser('recente@exemplo.com', {
        accessRequestedAt: new Date(Date.now() - 29 * DAY_MS),
      });
      const rejected = await t.prisma.user.create({
        data: {
          email: 'recusado-ha-tempo@exemplo.com',
          name: 'X',
          accessStatus: 'rejected',
          accessRequestedAt: new Date(Date.now() - 40 * DAY_MS),
        },
      });
      const users = t.app.get(UsersService);
      const trashed = await users.trashExpiredPendingRequests(30);
      expect(trashed).toBe(1);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: old.id } })).accessStatus).toBe(
        'trashed',
      );
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: recent.id } })).accessStatus,
      ).toBe('pending');
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: rejected.id } })).accessStatus,
      ).toBe('rejected');
    });

    it('CT-16b RN-19b: pending com ticket não vai para a lixeira mesmo expirado', async () => {
      const { company, department } = await reference();
      const group = await t.prisma.group.create({ data: { name: 'G1' } });
      const category = await t.prisma.category.create({
        data: { name: 'Geral', defaultGroupId: group.id },
      });
      const withTicket = await pendingUser('com-ticket@exemplo.com', {
        companyId: company.id,
        departmentId: department.id,
        accessRequestedAt: new Date(Date.now() - 40 * DAY_MS),
      });
      await t.prisma.ticket.create({
        data: {
          subject: 'Dúvida',
          source: 'email',
          requesterId: withTicket.id,
          groupId: group.id,
          categoryId: category.id,
        },
      });
      const users = t.app.get(UsersService);
      await users.trashExpiredPendingRequests(30);
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: withTicket.id } })).accessStatus,
      ).toBe('pending');
    });

    it('CT-18 restaura da lixeira → pending, com novo accessRequestedAt', async () => {
      const target = await t.prisma.user.create({
        data: {
          email: 'lixeira1@exemplo.com',
          name: 'X',
          accessStatus: 'trashed',
          trashedAt: new Date(),
          accessRequestedAt: new Date(Date.now() - 31 * DAY_MS),
        },
      });
      const res = await post(`/api/users/${target.id}/access/restore`, await adminToken()).expect(
        200,
      );
      expect(res.body.accessStatus).toBe('pending');
      const updated = await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(updated.accessRequestedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(updated.trashedAt).toBeNull();
    });

    it('CT-19 login próprio enquanto na lixeira → volta a pending e avisa os admins', async () => {
      await t.prisma.user.create({
        data: {
          email: 'admin2@missaosalesiana.org.br',
          name: 'Admin',
          roles: ['admin'],
          accessStatus: 'approved',
          active: true,
        },
      });
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-trashed',
          email: 'na-lixeira@missaosalesiana.org.br',
          name: 'Na Lixeira',
          accessStatus: 'trashed',
          trashedAt: new Date(),
          accessRequestedAt: new Date(Date.now() - 40 * DAY_MS),
        },
      });
      const res = await get('/api/me', await t.tokens.sign({ sub: 'sub-trashed' })).expect(200);
      expect(res.body.accessStatus).toBe('pending');
      expect(
        await t.prisma.notification.count({
          where: { template: 'access_request_created', toEmail: 'admin2@missaosalesiana.org.br' },
        }),
      ).toBe(1);
    });

    it('CT-23 esvazia a lixeira com 1 item com ticket → deleted/skipped corretos, o pulado volta a pending', async () => {
      const { company, department } = await reference();
      const group = await t.prisma.group.create({ data: { name: 'G1' } });
      const category = await t.prisma.category.create({
        data: { name: 'Geral', defaultGroupId: group.id },
      });
      const clean = await t.prisma.user.create({
        data: {
          email: 'lixeira-limpo@exemplo.com',
          name: 'X',
          accessStatus: 'trashed',
          trashedAt: new Date(),
        },
      });
      const withTicket = await t.prisma.user.create({
        data: {
          email: 'lixeira-ticket@exemplo.com',
          name: 'Y',
          accessStatus: 'trashed',
          trashedAt: new Date(),
          companyId: company.id,
          departmentId: department.id,
        },
      });
      await t.prisma.ticket.create({
        data: {
          subject: 'x',
          source: 'email',
          requesterId: withTicket.id,
          groupId: group.id,
          categoryId: category.id,
        },
      });
      const res = await http()
        .delete('/api/users/access-requests/trash')
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(200);
      expect(res.body).toEqual({ deleted: 1, skipped: 1 });
      expect(await t.prisma.user.findUnique({ where: { id: clean.id } })).toBeNull();
      const kept = await t.prisma.user.findUniqueOrThrow({ where: { id: withTicket.id } });
      expect(kept.accessStatus).toBe('pending');
    });

    it('CT-24 supervisor tentando esvaziar a lixeira → 403 FORBIDDEN_ROLE', async () => {
      const { company, department } = await reference();
      await t.prisma.user.create({
        data: {
          zitadelSub: 'sub-sup2',
          email: 'sup2@missaosalesiana.org.br',
          name: 'Supervisor',
          roles: ['supervisor'],
          companyId: company.id,
          departmentId: department.id,
          accessStatus: 'approved',
        },
      });
      const res = await http()
        .delete('/api/users/access-requests/trash')
        .set(
          'Authorization',
          `Bearer ${await t.tokens.sign({ sub: 'sub-sup2', roles: ['supervisor'] })}`,
        )
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('CT-25 item na lixeira há 400 dias continua lá: não há exclusão automática', async () => {
      const target = await t.prisma.user.create({
        data: {
          email: 'lixeira-antiga@exemplo.com',
          name: 'X',
          accessStatus: 'trashed',
          trashedAt: new Date(Date.now() - 400 * DAY_MS),
          accessRequestedAt: new Date(Date.now() - 430 * DAY_MS),
        },
      });
      const users = t.app.get(UsersService);
      await users.trashExpiredPendingRequests(30);
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessStatus,
      ).toBe('trashed');
    });
  });
});
