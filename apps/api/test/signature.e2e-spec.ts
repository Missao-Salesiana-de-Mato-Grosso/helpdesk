// Spec docs/specs/T31-assinatura-email.md — cadastro da assinatura (RN-01 a RN-06). A autorização
// por papel está na matriz de permissões; o uso no e-mail, em notifications.e2e-spec.ts.
import { MAX_SIGNATURE_HTML_LENGTH, type SignatureResponse } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- corpo do Supertest é `any`.
const signatureOf = (res: Response) => res.body as SignatureResponse;

describe('assinatura de e-mail — T31 (e2e)', () => {
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
  const as = async (user: 'ag1' | 'ag2' | 'req1') => `Bearer ${await f.token(user)}`;
  const get = async (user: 'ag1' | 'ag2' | 'req1') =>
    http()
      .get('/api/me/signature')
      .set('Authorization', await as(user));
  const put = async (user: 'ag1' | 'ag2' | 'req1', body: object) =>
    http()
      .put('/api/me/signature')
      .set('Authorization', await as(user))
      .send(body);
  const stored = async (user: 'ag1' | 'ag2') =>
    (await t.prisma.user.findUniqueOrThrow({ where: { id: f.users[user] } })).signatureHtml;

  it('CT-01 agente sem assinatura lê null', async () => {
    const res = await get('ag1');
    expect(res.status).toBe(200);
    expect(signatureOf(res)).toEqual({ signatureHtml: null });
  });

  it('CT-02 agente grava e relê a própria assinatura; a de outro agente não muda', async () => {
    const html = '<p>João Silva</p><p>TI</p>';
    const saved = await put('ag1', { signatureHtml: html });
    expect(saved.status).toBe(200);
    expect(signatureOf(saved)).toEqual({ signatureHtml: html });
    expect(signatureOf(await get('ag1'))).toEqual({ signatureHtml: html });

    expect(await stored('ag2')).toBeNull();
    expect(signatureOf(await get('ag2'))).toEqual({ signatureHtml: null });
  });

  it('CT-04 acima do limite, sem o campo ou com campo extra → 422 e nada gravado', async () => {
    for (const body of [
      { signatureHtml: 'a'.repeat(MAX_SIGNATURE_HTML_LENGTH + 1) },
      {},
      { signatureHtml: '<p>x</p>', name: 'x' },
    ]) {
      const res = await put('ag1', body);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(await stored('ag1')).toBeNull();
  });

  it('CT-05 sanitiza antes de gravar: só o que o editor produz sobrevive', async () => {
    const res = await put('ag1', {
      signatureHtml:
        '<p style="color:red"><strong>João</strong></p><script>x()</script>' +
        '<img src="https://x.org/logo.png"><table><tr><td>cel</td></tr></table><h1>Título</h1>' +
        '<a href="javascript:alert(1)">ruim</a><a href="https://msmt.org.br">site</a>',
    });
    expect(res.status).toBe(200);
    const expected =
      '<p><strong>João</strong></p>celTítulo' +
      '<a target="_blank" rel="noopener noreferrer">ruim</a>' +
      '<a href="https://msmt.org.br" target="_blank" rel="noopener noreferrer">site</a>';
    expect(signatureOf(res)).toEqual({ signatureHtml: expected });
    expect(await stored('ag1')).toBe(expected);
  });

  it('CT-06 sem texto visível depois de sanitizar → apaga a assinatura', async () => {
    for (const empty of ['', '<p> </p>', '<img src="https://x.org/logo.png">']) {
      await put('ag1', { signatureHtml: '<p>João</p>' });
      expect(await stored('ag1')).toBe('<p>João</p>');

      const res = await put('ag1', { signatureHtml: empty });
      expect(res.status).toBe(200);
      expect(signatureOf(res)).toEqual({ signatureHtml: null });
      expect(await stored('ag1')).toBeNull();
    }
  });

  it('RN-02 solicitante não lê nem grava assinatura', async () => {
    expect((await get('req1')).status).toBe(403);
    expect((await put('req1', { signatureHtml: '<p>x</p>' })).status).toBe(403);
  });
});
