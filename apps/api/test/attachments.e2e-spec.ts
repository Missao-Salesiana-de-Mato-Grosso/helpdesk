// T13: anexos — upload junto com o ticket ou a mensagem (multipart) e download com checagem de escopo.
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

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const detailOf = (res: Response) => res.body as TicketDetail;
const pdf = Buffer.from('%PDF-1.4 conteúdo de teste');

/** Arquivos gravados no storage local dos testes. */
async function storedFiles(): Promise<string[]> {
  try {
    const entries = await readdir(E2E_STORAGE_PATH, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

describe('anexos — T13 (e2e)', () => {
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
  const newTicket = () => ({
    subject: 'Com anexo',
    bodyHtml: '<p>Segue o print</p>',
    categoryId: f.C1,
  });

  async function postTicket(user: Login, files: [Buffer, string][], data: object = newTicket()) {
    let req = http()
      .post('/api/tickets')
      .set('Authorization', await as(user))
      .field('data', JSON.stringify(data));
    for (const [buffer, name] of files) req = req.attach('files', buffer, name);
    return req;
  }

  async function postMessage(
    user: Login,
    ticketId: string,
    data: object,
    files: [Buffer, string][],
  ) {
    let req = http()
      .post(`/api/tickets/${ticketId}/messages`)
      .set('Authorization', await as(user))
      .field('data', JSON.stringify(data));
    for (const [buffer, name] of files) req = req.attach('files', buffer, name);
    return req;
  }

  const download = async (user: Login, id: string) =>
    http()
      .get(`/api/attachments/${id}`)
      .set('Authorization', await as(user))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  async function ticketWithAttachment() {
    const res = await postTicket('req1', [[pdf, 'relatório final.pdf']]);
    const ticket = detailOf(res);
    return { ticket, attachmentId: ticket.messages[0]!.attachments[0]!.id };
  }

  describe('upload', () => {
    it('ticket novo com 2 anexos: grava no storage e lista no detalhe (tipo pela extensão)', async () => {
      const res = await postTicket('req1', [
        [pdf, 'relatório final.pdf'],
        [Buffer.from('a;b'), 'planilha.CSV'],
      ]);
      expect(res.status).toBe(201);
      expect(detailOf(res).messages[0]?.attachments).toEqual([
        expect.objectContaining({
          filename: 'relatório final.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
        }),
        expect.objectContaining({ filename: 'planilha.CSV', mimeType: 'text/csv', sizeBytes: 3 }),
      ]);
      expect(await storedFiles()).toHaveLength(2);
    });

    it('arquivo acima de 20 MB → 413 FILE_TOO_LARGE e nada gravado', async () => {
      const res = await postTicket('req1', [[Buffer.alloc(20 * 1024 * 1024 + 1), 'grande.pdf']]);
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('FILE_TOO_LARGE');
      expect(await t.prisma.ticket.count()).toBe(0);
      expect(await storedFiles()).toHaveLength(0);
    });

    it.each(['pagina.html', 'imagem.svg', 'programa.exe', 'sem-extensao'])(
      'tipo fora da lista (%s) → 415 UNSUPPORTED_FILE_TYPE',
      async (name) => {
        const res = await postTicket('req1', [
          [pdf, 'ok.pdf'],
          [Buffer.from('x'), name],
        ]);
        expect(res.status).toBe(415);
        expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
        expect(await storedFiles()).toHaveLength(0);
      },
    );

    it.each([6, 7])('%i arquivos → 422 TOO_MANY_FILES', async (count) => {
      const files = Array.from({ length: count }, (_, i): [Buffer, string] => [pdf, `f${i}.pdf`]);
      const res = await postTicket('req1', files);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TOO_MANY_FILES');
      expect(await storedFiles()).toHaveLength(0);
    });

    it('mensagem com anexo em ticket fora do escopo → 404 sem gravar no storage', async () => {
      const other = await f.ticket({ requester: 'req2' });
      const res = await postMessage('req1', other.id, { kind: 'public', bodyHtml: '<p>x</p>' }, [
        [pdf, 'a.pdf'],
      ]);
      expect(res.status).toBe(404);
      expect(await storedFiles()).toHaveLength(0);
    });

    it('falha na transação (ticket fechado) apaga os arquivos já gravados', async () => {
      const closed = await f.ticket({ requester: 'req1', status: 'closed' });
      const res = await postMessage('req1', closed.id, { kind: 'public', bodyHtml: '<p>x</p>' }, [
        [pdf, 'a.pdf'],
      ]);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TICKET_CLOSED');
      expect(await storedFiles()).toHaveLength(0);
      expect(await t.prisma.attachment.count()).toBe(0);
    });

    it('anexo sem texto continua exigindo corpo (EMPTY_BODY)', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      const res = await postMessage('req1', ticket.id, { kind: 'public', bodyHtml: '<p></p>' }, [
        [pdf, 'a.pdf'],
      ]);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('EMPTY_BODY');
    });

    it('campo data com JSON inválido → 422 VALIDATION_ERROR', async () => {
      const res = await http()
        .post('/api/tickets')
        .set('Authorization', await as('req1'))
        .field('data', '{nao-e-json')
        .attach('files', pdf, 'a.pdf');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('download', () => {
    it('solicitante baixa o próprio anexo: bytes, tipo, nome UTF-8, nosniff, sem cache', async () => {
      const { attachmentId } = await ticketWithAttachment();
      const res = await download('req1', attachmentId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(pdf);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="relat_rio final.pdf"; filename*=UTF-8''relat%C3%B3rio%20final.pdf`,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('sem acesso ao ticket → 404 (outro solicitante e agente de outro grupo); supervisor baixa', async () => {
      const { attachmentId } = await ticketWithAttachment();
      expect((await download('req2', attachmentId)).status).toBe(404);
      expect((await download('ag2', attachmentId)).status).toBe(404);
      expect((await download('ag1', attachmentId)).status).toBe(200);
      expect((await download('sup', attachmentId)).status).toBe(200);
      expect((await download('req1', '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await download('req1', 'abc')).status).toBe(404);
    });

    it('anexo de nota interna: agente baixa; solicitante não vê nem baixa (404)', async () => {
      const { ticket } = await ticketWithAttachment();
      const note = await postMessage(
        'ag1',
        ticket.id,
        { kind: 'internal', bodyHtml: '<p>log</p>' },
        [[Buffer.from('log'), 'servidor.txt']],
      );
      expect(note.status).toBe(201);
      const internalId = detailOf(note).messages.at(-1)!.attachments[0]!.id;
      expect((await download('ag1', internalId)).status).toBe(200);
      expect((await download('req1', internalId)).status).toBe(404);
      const seen = await http()
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', await as('req1'));
      const ids = detailOf(seen).messages.flatMap((m) => m.attachments.map((a) => a.id));
      expect(ids).not.toContain(internalId);
    });
  });
});
