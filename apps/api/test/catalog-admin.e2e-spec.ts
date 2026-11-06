// T25: cadastros de referência pela tela de admin (unidades, departamentos, grupos e categorias).
// A autorização (só admin) está na matriz de permissões; aqui ficam as regras.
import type {
  CatalogItem,
  CategoryItem,
  GroupItem,
  NamedRef,
  TicketDetail,
} from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

// Corpo da resposta tipado pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const itemOf = (res: Response) => res.body as CatalogItem;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const itemsOf = (res: Response) => res.body as CatalogItem[];
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const groupOf = (res: Response) => res.body as GroupItem;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const categoryOf = (res: Response) => res.body as CategoryItem;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const categoriesOf = (res: Response) => res.body as CategoryItem[];
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const detailOf = (res: Response) => res.body as TicketDetail;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const names = (res: Response) => (res.body as NamedRef[]).map((item) => item.name);

describe('cadastros de referência (T25, e2e)', () => {
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

  const as = async (user: 'adm' | 'req1' = 'adm') => `Bearer ${await f.token(user)}`;
  const get = async (path: string, user?: 'adm' | 'req1') =>
    request(t.app.getHttpServer())
      .get(path)
      .set('Authorization', await as(user));
  const post = async (path: string, body: object) =>
    request(t.app.getHttpServer())
      .post(path)
      .set('Authorization', await as())
      .send(body);
  const patch = async (path: string, body: object) =>
    request(t.app.getHttpServer())
      .patch(path)
      .set('Authorization', await as())
      .send(body);

  describe('unidades e departamentos', () => {
    it('cria, renomeia e desativa; a lista pública só mostra os ativos', async () => {
      const created = await post('/api/admin/companies', { name: '  Escola Nova ' });
      expect(created.status).toBe(201);
      const company = itemOf(created);
      expect(company).toMatchObject({ name: 'Escola Nova', active: true });

      const renamed = await patch(`/api/admin/companies/${company.id}`, {
        name: 'Escola Dom Bosco',
      });
      expect(itemOf(renamed).name).toBe('Escola Dom Bosco');

      await patch(`/api/admin/companies/${f.U2}`, { active: false }).then((res) =>
        expect(res.status).toBe(200),
      );
      expect(names(await get('/api/companies', 'req1'))).toEqual(['Escola Dom Bosco', 'Unidade 1']);

      const all = itemsOf(await get('/api/admin/companies'));
      expect(all.map((item) => [item.name, item.active])).toEqual([
        ['Escola Dom Bosco', true],
        ['Unidade 1', true],
        ['Unidade 2', false],
      ]);
    });

    it('unidade desativada continua no usuário e no ticket que já a usam', async () => {
      const ticket = await f.ticket({ requester: 'req2', group: 'G1', company: 'U2' });
      await patch(`/api/admin/companies/${f.U2}`, { active: false });

      const detail = detailOf(await get(`/api/tickets/${ticket.id}`));
      expect(detail.company?.id).toBe(f.U2);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: f.users.req2 } });
      expect(user.companyId).toBe(f.U2);
    });

    it('nome repetido, sem diferenciar maiúsculas → 409 NAME_TAKEN', async () => {
      const res = await post('/api/admin/departments', { name: 'SECRETARIA' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'NAME_TAKEN' });

      const other = itemOf(await post('/api/admin/departments', { name: 'Financeiro' }));
      const rename = await patch(`/api/admin/departments/${other.id}`, { name: 'secretaria' });
      expect(rename.status).toBe(409);
      // Mudar só a caixa do próprio nome não conflita com ele mesmo.
      const own = await patch(`/api/admin/departments/${f.D1}`, { name: 'SECRETARIA' });
      expect(own.status).toBe(200);
    });

    it('id inexistente ou inválido → 404; corpo vazio → 422', async () => {
      expect(
        (await patch('/api/admin/departments/00000000-0000-4000-8000-000000000000', { name: 'X' }))
          .status,
      ).toBe(404);
      expect((await patch('/api/admin/departments/abc', { name: 'X' })).status).toBe(404);
      expect((await patch(`/api/admin/departments/${f.D1}`, {})).status).toBe(422);
    });
  });

  describe('grupos', () => {
    it('cria com e-mail de aviso, troca e limpa o e-mail', async () => {
      const created = groupOf(
        await post('/api/admin/groups', { name: 'Redes', email: 'redes@missaosalesiana.org.br' }),
      );
      expect(created).toMatchObject({ email: 'redes@missaosalesiana.org.br', active: true });

      const cleared = await patch(`/api/admin/groups/${created.id}`, { email: '' });
      expect(groupOf(cleared).email).toBeNull();
    });

    it('não desativa grupo padrão de categoria ativa (422 GROUP_IN_USE)', async () => {
      const res = await patch(`/api/admin/groups/${f.G2}`, { active: false });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'GROUP_IN_USE', categories: ['Categoria 2'] });

      await patch(`/api/admin/categories/${f.C2}`, { active: false });
      const ok = await patch(`/api/admin/groups/${f.G2}`, { active: false });
      expect(ok.status).toBe(200);
      expect(names(await get('/api/groups'))).toEqual(['Grupo 1']);
    });
  });

  describe('categorias', () => {
    it('cria com grupo padrão e aparece no formulário de novo ticket', async () => {
      const created = await post('/api/admin/categories', { name: 'Rede', defaultGroupId: f.G2 });
      expect(created.status).toBe(201);
      expect(categoryOf(created)).toMatchObject({
        name: 'Rede',
        defaultGroup: { id: f.G2, name: 'Grupo 2', active: true },
        locked: false,
      });
      expect(names(await get('/api/categories', 'req1'))).toContain('Rede');
    });

    it('grupo padrão inexistente ou inativo → 422 INACTIVE_REFERENCE', async () => {
      const group = await t.prisma.group.create({ data: { name: 'Parado', active: false } });
      const res = await post('/api/admin/categories', { name: 'Rede', defaultGroupId: group.id });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'INACTIVE_REFERENCE' });
      expect(
        (await patch(`/api/admin/categories/${f.C1}`, { defaultGroupId: group.id })).status,
      ).toBe(422);
    });

    it('"Geral" não se renomeia nem desativa, mas troca de grupo padrão', async () => {
      const geral = await t.prisma.category.create({
        data: { name: 'Geral', defaultGroupId: f.G1 },
      });
      const list = categoriesOf(await get('/api/admin/categories'));
      expect(list.find((item) => item.id === geral.id)?.locked).toBe(true);

      for (const body of [{ name: 'Outros' }, { active: false }]) {
        const res = await patch(`/api/admin/categories/${geral.id}`, body);
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ code: 'PROTECTED_ITEM' });
      }
      const moved = await patch(`/api/admin/categories/${geral.id}`, {
        name: 'Geral',
        active: true,
        defaultGroupId: f.G2,
      });
      expect(moved.status).toBe(200);
      expect(categoryOf(moved).defaultGroup.id).toBe(f.G2);
    });
  });
});
