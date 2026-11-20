// Spec docs/specs/T38-busca-full-text.md — busca no texto das mensagens e nos nomes dos anexos.
import type { TicketListResponse, TicketSummary } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import {
  createTicketsFixture,
  type FixtureUser,
  type TicketOptions,
  type TicketsFixture,
} from './setup/tickets-fixture.js';

type Login = Exclude<FixtureUser, 'ext1'>;

// Corpo da resposta tipado pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as TicketListResponse;
const ids = (items: TicketSummary[]) => items.map((item) => item.id).toSorted();

const S = '\uE000';
const E = '\uE001';

describe('busca no texto, T38 (e2e)', () => {
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

  /** Lista como o agente/supervisor (`view=all`) ou o solicitante (`view=requested`). */
  const search = async (user: Login, q: string): Promise<TicketSummary[]> => {
    const view = user === 'req1' || user === 'req2' ? 'requested' : 'all';
    const res = await request(t.app.getHttpServer())
      .get('/api/tickets')
      .query({ view, q, status: ['open', 'pending', 'resolved', 'closed'] })
      .set('Authorization', `Bearer ${await f.token(user)}`);
    expect(res.status).toBe(200);
    return listOf(res).items;
  };

  /** Chamado da fixture com mais uma mensagem (e, se pedido, um anexo nela). */
  async function ticketWith(
    options: TicketOptions,
    message: {
      body: string;
      quoted?: string;
      kind?: 'public' | 'internal';
      file?: string;
      createdAt?: Date;
    },
  ) {
    const ticket = await f.ticket(options);
    const created = await t.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: f.users.ag1,
        kind: message.kind ?? 'public',
        via: 'portal',
        bodyHtml: message.body,
        quotedHtml: message.quoted ?? null,
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      },
    });
    if (message.file) {
      await t.prisma.attachment.create({
        data: {
          messageId: created.id,
          storageKey: `k/${created.id}`,
          filename: message.file,
          mimeType: 'application/pdf',
          sizeBytes: 10,
        },
      });
    }
    return ticket;
  }

  it('CT-01 texto pesquisável: sem tags, entidades decodificadas, sem acento', async () => {
    const [row] = await t.prisma.$queryRaw<{ plain: string; folded: string }[]>`
      SELECT helpdesk_plain_text('<p>Configuração da <b>Impressora</b> &amp; rede</p>') AS plain,
        helpdesk_fold('Configuração ÁGUA') AS folded`;
    expect(row?.plain.replaceAll(/\s+/g, ' ').trim()).toBe('Configuração da Impressora & rede');
    expect(row?.folded).toBe('Configuracao AGUA');
  });

  it('CT-02 acha pela mensagem pública, com o trecho e as palavras marcadas', async () => {
    const ticket = await ticketWith(
      { requester: 'req1', subject: 'Problema' },
      { body: '<p>As impressoras da secretaria não imprimem desde ontem.</p>' },
    );
    const [item] = await search('sup', 'impressora secretaria');
    expect(item?.id).toBe(ticket.id);
    expect(item?.match?.source).toBe('public');
    expect(item?.match?.snippet).toContain(`${S}impressoras${E}`);
    expect(item?.match?.snippet).toContain(`${S}secretaria${E}`);
    expect(item?.match?.snippet).toContain('não imprimem');
  });

  it('CT-03 sem acento e sem maiúscula; palavra ausente não acha', async () => {
    const ticket = await ticketWith(
      { requester: 'req1', subject: 'Problema' },
      { body: '<p>A impressão saiu borrada.</p>' },
    );
    for (const q of ['IMPRESSÃO', 'impressão', 'impressao']) {
      expect(ids(await search('sup', q))).toEqual([ticket.id]);
    }
    expect(await search('sup', 'impressao rede')).toEqual([]);
  });

  it('CT-04 nota interna: agente acha, solicitante não', async () => {
    const ticket = await ticketWith(
      { requester: 'req1', subject: 'Problema' },
      { body: '<p>Senha do roteador trocada.</p>', kind: 'internal' },
    );
    const [item] = await search('ag1', 'roteador');
    expect(item?.id).toBe(ticket.id);
    expect(item?.match?.source).toBe('internal');
    expect(await search('req1', 'roteador')).toEqual([]);
  });

  it('CT-05 acha pelo texto citado do e-mail', async () => {
    const ticket = await ticketWith(
      { requester: 'req1', subject: 'Problema' },
      { body: '<p>Segue.</p>', quoted: '<blockquote>O projetor da sala 3 queimou</blockquote>' },
    );
    expect(ids(await search('sup', 'projetor'))).toEqual([ticket.id]);
  });

  it('CT-06 nome de anexo: público para todos, de nota interna só para agentes', async () => {
    const boleto = await ticketWith(
      { requester: 'req1', subject: 'Pagamento' },
      { body: '<p>Segue o arquivo.</p>', file: 'Boleto_Janeiro.pdf' },
    );
    const planilha = await ticketWith(
      { requester: 'req1', subject: 'Custos' },
      { body: '<p>Anotação.</p>', kind: 'internal', file: 'planilha-secreta.xlsx' },
    );
    const [item] = await search('req1', 'boleto');
    expect(item?.id).toBe(boleto.id);
    expect(item?.match).toEqual({ snippet: 'Anexo: Boleto_Janeiro.pdf', source: 'attachment' });
    expect(await search('req1', 'planilha')).toEqual([]);
    expect(ids(await search('ag1', 'planilha'))).toEqual([planilha.id]);
  });

  it('CT-07 fora do escopo do agente não aparece', async () => {
    await ticketWith({ requester: 'req1', group: 'G1' }, { body: '<p>Catraca travada.</p>' });
    expect(await search('ag2', 'catraca')).toEqual([]);
  });

  it('CT-08 casa pelo assunto ou pelo texto; só o segundo traz trecho', async () => {
    const bySubject = await f.ticket({ requester: 'req1', subject: 'Nobreak apitando' });
    const byText = await ticketWith(
      { requester: 'req1', subject: 'Barulho' },
      { body: '<p>O nobreak da sala apita.</p>' },
    );
    const items = await search('sup', 'nobreak');
    expect(ids(items)).toEqual([bySubject.id, byText.id].toSorted());
    expect(items.find((i) => i.id === bySubject.id)?.match).toBeUndefined();
    expect(items.find((i) => i.id === byText.id)?.match).toBeDefined();
  });

  it('CT-09 número sozinho continua só pelo número', async () => {
    const target = await f.ticket({ requester: 'req1' });
    await ticketWith({ requester: 'req1' }, { body: `<p>Veja o chamado ${target.number}.</p>` });
    expect(ids(await search('sup', String(target.number)))).toEqual([target.id]);
  });

  it('CT-10 o trecho vem da mensagem mais recente que casa', async () => {
    const ticket = await ticketWith(
      { requester: 'req1', subject: 'Rede' },
      { body: '<p>Primeira vez que o switch falhou.</p>', createdAt: new Date('2026-11-01') },
    );
    await t.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: f.users.req1,
        kind: 'public',
        via: 'portal',
        bodyHtml: '<p>De novo o switch parou hoje.</p>',
        createdAt: new Date('2026-11-10'),
      },
    });
    const [item] = await search('sup', 'switch');
    expect(item?.match?.snippet).toContain('De novo');
  });

  it('CT-11 frase entre aspas e exclusão', async () => {
    const phrase = await ticketWith({ requester: 'req1' }, { body: '<p>A rede caiu agora.</p>' });
    const wifi = await ticketWith(
      { requester: 'req1' },
      { body: '<p>Caiu o wifi, a rede está lenta.</p>' },
    );
    expect(ids(await search('sup', '"rede caiu"'))).toEqual([phrase.id]);
    expect(ids(await search('sup', 'rede -wifi'))).toEqual([phrase.id]);
    expect(ids(await search('sup', 'rede'))).toEqual([phrase.id, wifi.id].toSorted());
  });

  it('CT-12 caracteres especiais não quebram a busca', async () => {
    await ticketWith({ requester: 'req1' }, { body: '<p>Texto.</p>', file: 'a.pdf' });
    for (const q of ['%_\\', "o'reilly", '"aberto', '--', '(rede)']) {
      await search('sup', q);
    }
  });
});
