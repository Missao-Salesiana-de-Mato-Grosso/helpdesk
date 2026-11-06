// T26: respostas prontas. A autorização por papel está na matriz de permissões; aqui ficam as regras.
import type { CannedResponse } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

// Corpo da resposta tipado pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const itemOf = (res: Response) => res.body as CannedResponse;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as CannedResponse[];

describe('respostas prontas (T26, e2e)', () => {
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

  const auth = async (user: 'adm' | 'sup' | 'ag1') => `Bearer ${await f.token(user)}`;
  const server = () => request(t.app.getHttpServer());

  it('supervisor cria; o agente vê a lista em ordem de título', async () => {
    for (const title of ['Senha expirada', 'Acesso ao Wi-Fi']) {
      const res = await server()
        .post('/api/canned-responses')
        .set('Authorization', await auth('sup'))
        .send({ title, bodyHtml: '<p>Olá, {{solicitante}}!</p>' });
      expect(res.status).toBe(201);
    }
    const list = listOf(
      await server()
        .get('/api/canned-responses')
        .set('Authorization', await auth('ag1')),
    );
    expect(list.map((item) => item.title)).toEqual(['Acesso ao Wi-Fi', 'Senha expirada']);
    expect(list[0]!.bodyHtml).toBe('<p>Olá, {{solicitante}}!</p>');

    const row = await t.prisma.cannedResponse.findFirstOrThrow({
      where: { title: 'Senha expirada' },
    });
    expect(row.createdById).toBe(f.users.sup);
  });

  it('sanitiza o texto e recusa texto vazio depois da sanitização', async () => {
    const created = await server()
      .post('/api/canned-responses')
      .set('Authorization', await auth('adm'))
      .send({ title: 'Teste', bodyHtml: '<p>Oi<script>alert(1)</script></p>' });
    expect(itemOf(created).bodyHtml).toBe('<p>Oi</p>');

    const empty = await server()
      .post('/api/canned-responses')
      .set('Authorization', await auth('adm'))
      .send({ title: 'Vazia', bodyHtml: '<script>x</script>' });
    expect(empty.status).toBe(422);
    expect(empty.body).toMatchObject({ code: 'EMPTY_BODY' });
  });

  it('título repetido, sem diferenciar maiúsculas → 409 NAME_TAKEN', async () => {
    const other = await t.prisma.cannedResponse.create({
      data: { title: 'B', bodyHtml: '<p>b</p>' },
    });
    await t.prisma.cannedResponse.create({ data: { title: 'Senha', bodyHtml: '<p>x</p>' } });

    const dup = await server()
      .post('/api/canned-responses')
      .set('Authorization', await auth('adm'))
      .send({ title: 'SENHA', bodyHtml: '<p>y</p>' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'NAME_TAKEN' });

    const rename = await server()
      .patch(`/api/canned-responses/${other.id}`)
      .set('Authorization', await auth('adm'))
      .send({ title: 'senha' });
    expect(rename.status).toBe(409);
  });

  it('edita o texto, exclui, e id inexistente ou inválido → 404', async () => {
    const row = await t.prisma.cannedResponse.create({
      data: { title: 'A', bodyHtml: '<p>a</p>' },
    });
    const edited = await server()
      .patch(`/api/canned-responses/${row.id}`)
      .set('Authorization', await auth('adm'))
      .send({ bodyHtml: '<p>novo</p>' });
    expect(itemOf(edited)).toMatchObject({ title: 'A', bodyHtml: '<p>novo</p>' });

    const removed = await server()
      .delete(`/api/canned-responses/${row.id}`)
      .set('Authorization', await auth('adm'));
    expect(removed.status).toBe(204);
    expect(await t.prisma.cannedResponse.count()).toBe(0);

    const missing = '00000000-0000-4000-8000-000000000000';
    for (const req of [
      server().delete(`/api/canned-responses/${row.id}`),
      server().patch(`/api/canned-responses/${missing}`).send({ title: 'X' }),
      server().patch('/api/canned-responses/abc').send({ title: 'X' }),
    ]) {
      expect((await req.set('Authorization', await auth('adm'))).status).toBe(404);
    }
  });
});
