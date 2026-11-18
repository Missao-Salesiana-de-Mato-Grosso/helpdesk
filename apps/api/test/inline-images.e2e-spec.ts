// T32: imagens no corpo da mensagem — upload no campo `inline`, referência por id no corpo.
import type { TicketDetail } from '@helpdesk/shared';
import { readdir, rm } from 'node:fs/promises';
import request, { type Response } from 'supertest';
import { E2E_STORAGE_PATH } from '../vitest.config.e2e.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import {
  createTicketsFixture,
  type FixtureUser,
  type TicketsFixture,
} from './setup/tickets-fixture.js';

type Login = Exclude<FixtureUser, 'ext1'>;
type Upload = [Buffer, string];

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const detailOf = (res: Response) => res.body as TicketDetail;
const png = Buffer.from('\u0089PNG imagem de teste');
const pdf = Buffer.from('%PDF-1.4 conteúdo de teste');

const withImage = (key = 'a') => ({
  kind: 'public',
  bodyHtml: `<p>Veja o erro:</p><img data-inline-key="${key}" alt="tela">`,
  inlineImages: [key],
});

const lastMessage = (res: Response) => detailOf(res).messages.at(-1)!;

/** `count` imagens no texto: o JSON com as chaves e os arquivos do campo `inline`. */
function images(count: number) {
  const keys = Array.from({ length: count }, (_, i) => `k${i}`);
  return {
    data: {
      kind: 'public',
      bodyHtml: keys.map((key) => `<img data-inline-key="${key}">`).join(''),
      inlineImages: keys,
    },
    inline: keys.map((key): Upload => [png, `${key}.png`]),
  };
}

async function storedFiles(): Promise<string[]> {
  try {
    const entries = await readdir(E2E_STORAGE_PATH, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

describe('imagens no texto — T32 (e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await rm(E2E_STORAGE_PATH, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    await rm(E2E_STORAGE_PATH, { recursive: true, force: true });
    t.cache.clear();
    f = await createTicketsFixture(t);
  });

  const http = () => request(t.app.getHttpServer());
  const as = async (user: Login) => `Bearer ${await f.token(user)}`;

  async function send(
    user: Login,
    path: string,
    data: object,
    inline: Upload[],
    files: Upload[] = [],
  ) {
    let req = http()
      .post(path)
      .set('Authorization', await as(user))
      .field('data', JSON.stringify(data));
    for (const [buffer, name] of files) req = req.attach('files', buffer, name);
    for (const [buffer, name] of inline) req = req.attach('inline', buffer, name);
    return req;
  }

  const reply = (user: Login, ticketId: string, data: object, inline: Upload[], files?: Upload[]) =>
    send(user, `/api/tickets/${ticketId}/messages`, data, inline, files);

  const download = async (user: Login, id: string) =>
    http()
      .get(`/api/attachments/${id}`)
      .set('Authorization', await as(user));

  it('CT-01 resposta com imagem: anexo inline e corpo com data-attachment-id, sem src', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const res = await reply('ag1', ticket.id, withImage(), [[png, 'print.png']]);
    expect(res.status).toBe(201);

    const message = lastMessage(res);
    expect(message.attachments).toEqual([
      expect.objectContaining({ filename: 'print.png', mimeType: 'image/png', inline: true }),
    ]);
    const id = message.attachments[0]!.id;
    expect(message.bodyHtml).toBe(
      `<p>Veja o erro:</p><img data-attachment-id="${id}" alt="tela" />`,
    );
    expect(await storedFiles()).toHaveLength(1);
  });

  it('CT-02 abertura de chamado pelo solicitante e nota interna do agente com imagem', async () => {
    const created = await send(
      'req1',
      '/api/tickets',
      {
        subject: 'Erro na tela',
        categoryId: f.C1,
        bodyHtml: '<img data-inline-key="k1">',
        inlineImages: ['k1'],
      },
      [[png, 'erro.jpg']],
    );
    expect(created.status).toBe(201);
    const first = detailOf(created).messages[0]!;
    expect(first.attachments[0]).toMatchObject({ inline: true, mimeType: 'image/jpeg' });
    expect(first.bodyHtml).toContain(`data-attachment-id="${first.attachments[0]!.id}"`);

    const note = await reply('ag1', detailOf(created).id, { ...withImage(), kind: 'internal' }, [
      [png, 'nota.webp'],
    ]);
    expect(note.status).toBe(201);
    expect(lastMessage(note)).toMatchObject({ kind: 'internal' });
    expect(lastMessage(note).attachments[0]).toMatchObject({ inline: true });
  });

  it('CT-03 arquivo que não é imagem no campo inline → 415 e nada gravado', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const res = await reply('ag1', ticket.id, withImage(), [[pdf, 'doc.pdf']]);
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await storedFiles()).toHaveLength(0);
    expect(await t.prisma.ticketMessage.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it('CT-04 imagem acima de 5 MB → 413 FILE_TOO_LARGE', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const res = await reply('ag1', ticket.id, withImage(), [
      [Buffer.alloc(5 * 1024 * 1024 + 1), 'grande.png'],
    ]);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('CT-05 11 imagens → 422; 10 imagens e 5 anexos comuns → 201', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const tooMany = images(11);
    const refused = await reply('ag1', ticket.id, tooMany.data, tooMany.inline);
    expect(refused.status).toBe(422);
    expect(await storedFiles()).toHaveLength(0);

    const ok = images(10);
    const files = Array.from({ length: 5 }, (_, i): Upload => [pdf, `f${i}.pdf`]);
    const res = await reply('ag1', ticket.id, ok.data, ok.inline, files);
    expect(res.status).toBe(201);
    const attachments = lastMessage(res).attachments;
    expect(attachments.filter((a) => a.inline)).toHaveLength(10);
    expect(attachments.filter((a) => !a.inline)).toHaveLength(5);
  });

  it('CT-06 data-attachment-id de outra mensagem e img data: são removidos', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const first = await reply('ag1', ticket.id, withImage(), [[png, 'print.png']]);
    const foreignId = lastMessage(first).attachments[0]!.id;

    const res = await reply(
      'ag1',
      ticket.id,
      {
        kind: 'public',
        bodyHtml: `<p>texto</p><img data-attachment-id="${foreignId}"><img src="data:image/png;base64,AAAA">`,
      },
      [],
    );
    expect(res.status).toBe(201);
    expect(lastMessage(res).bodyHtml).toBe('<p>texto</p>');
  });

  it('CT-07 imagem sem referência no texto não é gravada; chave sem arquivo é removida', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const unused = await reply(
      'ag1',
      ticket.id,
      { kind: 'public', bodyHtml: '<p>apaguei a imagem</p>', inlineImages: ['a'] },
      [[png, 'print.png']],
    );
    expect(unused.status).toBe(201);
    expect(lastMessage(unused).attachments).toEqual([]);
    expect(await storedFiles()).toHaveLength(0);

    const orphan = await reply(
      'ag1',
      ticket.id,
      { kind: 'public', bodyHtml: '<p>oi</p><img data-inline-key="sem-arquivo">' },
      [],
    );
    expect(orphan.status).toBe(201);
    expect(lastMessage(orphan).bodyHtml).toBe('<p>oi</p>');
  });

  it('CT-08 mensagem só com imagem é válida', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const res = await reply(
      'req1',
      ticket.id,
      { kind: 'public', bodyHtml: '<img data-inline-key="a">', inlineImages: ['a'] },
      [[png, 'print.png']],
    );
    expect(res.status).toBe(201);
  });

  it('CT-09 só baixa a imagem quem vê a mensagem', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const pub = await reply('ag1', ticket.id, withImage(), [[png, 'print.png']]);
    const publicId = lastMessage(pub).attachments[0]!.id;
    const note = await reply('ag1', ticket.id, { ...withImage(), kind: 'internal' }, [
      [png, 'nota.png'],
    ]);
    const internalId = lastMessage(note).attachments[0]!.id;

    expect((await download('req1', publicId)).status).toBe(200);
    expect((await download('req2', publicId)).status).toBe(404);
    expect((await download('req1', internalId)).status).toBe(404);
    expect((await download('ag1', internalId)).status).toBe(200);
  });

  it('CT-10 quantidade de arquivos diferente de inlineImages → 422 VALIDATION_ERROR', async () => {
    const ticket = await f.ticket({ requester: 'req1' });
    const res = await reply('ag1', ticket.id, { ...withImage(), inlineImages: ['a', 'b'] }, [
      [png, 'print.png'],
    ]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await storedFiles()).toHaveLength(0);
  });
});
