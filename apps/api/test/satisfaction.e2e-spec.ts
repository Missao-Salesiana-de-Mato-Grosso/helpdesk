// Spec docs/specs/T40-csat.md — pesquisa de satisfação: link na resolução, rotas públicas, painel e
// relatórios.
import type {
  ReportSummary,
  SatisfactionReport,
  SatisfactionSurvey,
  TicketDetail,
} from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import { hashSurveyToken } from '../src/satisfaction/survey-token.js';
import { TicketsService } from '../src/tickets/tickets.service.js';
import { SYSTEM_USER_EMAIL } from '../src/users/system-user.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import {
  createTicketsFixture,
  type FixtureUser,
  type TicketsFixture,
} from './setup/tickets-fixture.js';

type Login = Exclude<FixtureUser, 'ext1'>;

// Corpos tipados pelo contrato de @helpdesk/shared (o Supertest devolve `any`).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const surveyOf = (res: Response) => res.body as SatisfactionSurvey;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const detailOf = (res: Response) => res.body as TicketDetail;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const summaryOf = (res: Response) => res.body as ReportSummary;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const listOf = (res: Response) => res.body as SatisfactionReport;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- payload gravado pelo enqueue.
const payloadOf = (row: { payload: unknown }) => row.payload as Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const email = (user: FixtureUser) => `${user}@missaosalesiana.org.br`;
/** Meio-dia em Cuiabá (UTC−4). */
const noon = (date: string) => new Date(`${date}T16:00:00Z`);
const OCTOBER = 'from=2026-10-01&to=2026-10-31';
const UNKNOWN_TOKEN = 'b'.repeat(43);

describe('pesquisa de satisfação — T40 (e2e)', () => {
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
  const patch = async (user: Login, id: string, body: object) =>
    http()
      .patch(`/api/tickets/${id}`)
      .set('Authorization', await as(user))
      .send(body);
  const message = async (user: Login, id: string, body: object) =>
    http()
      .post(`/api/tickets/${id}/messages`)
      .set('Authorization', await as(user))
      .send(body);
  const detail = async (user: Login, id: string) =>
    http()
      .get(`/api/tickets/${id}`)
      .set('Authorization', await as(user));
  const lookup = (token: string) => http().post('/api/satisfaction/lookup').send({ token });
  const rate = (body: object) => http().put('/api/satisfaction').send(body);
  const surveyRow = (ticketId: string) =>
    t.prisma.ticketSatisfaction.findUnique({ where: { ticketId } });

  /** O token do último link enviado ao solicitante do chamado (tirado do `csatUrl` da outbox). */
  const tokenOf = async (ticketId: string): Promise<string> => {
    const rows = await t.prisma.notification.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
    });
    const url = rows
      .map((row) => payloadOf(row).csatUrl)
      .find((value): value is string => typeof value === 'string');
    if (!url) throw new Error('Nenhum link de avaliação na outbox');
    return url.slice(url.indexOf('#') + 1);
  };

  /** Resolve pelo PATCH e devolve a versão nova. */
  const resolve = async (id: string, version: number, user: Login = 'ag1') => {
    const res = await patch(user, id, { version, status: 'resolved' });
    expect(res.status).toBe(200);
    return detailOf(res).version;
  };

  const reopen = async (id: string, version: number) => {
    const res = await patch('ag1', id, { version, status: 'open' });
    expect(res.status).toBe(200);
    return detailOf(res).version;
  };

  const resolvedWithLink = async () => {
    const ticket = await f.ticket({ requester: 'req1', subject: 'Impressora da secretaria' });
    await resolve(ticket.id, 1);
    return { ticket, token: await tokenOf(ticket.id) };
  };

  /** Chamado com avaliação gravada direto no banco, nas datas pedidas. */
  const rated = async (
    score: number | null,
    ratedAt: string | null,
    requestedAt: string,
    options: { group?: 'G1' | 'G2'; assignee?: FixtureUser; createdAt?: Date } = {},
  ) => {
    const ticket = await f.ticket({
      requester: 'req1',
      group: options.group ?? 'G1',
      assignee: options.assignee ?? null,
      status: 'resolved',
    });
    await t.prisma.ticket.update({
      where: { id: ticket.id },
      data: { createdAt: options.createdAt ?? noon('2025-01-10') },
    });
    await t.prisma.ticketSatisfaction.create({
      data: {
        ticketId: ticket.id,
        requestedAt: noon(requestedAt),
        score,
        ratedAt: ratedAt ? noon(ratedAt) : null,
        comment: score === null ? null : `Nota ${score}`,
      },
    });
    return ticket;
  };

  describe('pedido de avaliação (RN-01 a RN-05)', () => {
    it('CT-01 resolver pelo PATCH grava o hash, vale 30 dias e manda o link ao solicitante', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await resolve(ticket.id, 1);

      const row = await surveyRow(ticket.id);
      expect(row).not.toBeNull();
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.expiresAt!.getTime() - row!.requestedAt.getTime()).toBe(30 * DAY_MS);
      expect(row!.score).toBeNull();

      const outbox = await t.prisma.notification.findMany({ where: { ticketId: ticket.id } });
      expect(outbox.map((n) => [n.template, n.toEmail])).toEqual([['resolved', email('req1')]]);
      const payload = payloadOf(outbox[0]!);
      expect(payload.csatUrl).toMatch(/^http:\/\/portal\.test\/avaliar#[A-Za-z0-9_-]{43}$/);
      expect(payload.csatDays).toBe(30);
      expect(hashSurveyToken(await tokenOf(ticket.id))).toBe(row!.tokenHash);
    });

    it('CT-02 a resposta que resolve e o lote também mandam o link', async () => {
      const replied = await f.ticket({ requester: 'req1' });
      const res = await message('ag1', replied.id, {
        kind: 'public',
        bodyHtml: '<p>Feito</p>',
        status: 'resolved',
        version: 1,
      });
      expect(res.status).toBe(201);
      const reply = await t.prisma.notification.findFirstOrThrow({
        where: { ticketId: replied.id },
      });
      expect(reply.template).toBe('reply');
      expect(payloadOf(reply).csatUrl).toEqual(expect.stringContaining('/avaliar#'));

      const a = await f.ticket({ requester: 'req1' });
      const b = await f.ticket({ requester: 'req1' });
      const bulk = await http()
        .patch('/api/tickets/bulk')
        .set('Authorization', await as('sup'))
        .send({
          tickets: [
            { id: a.id, version: 1 },
            { id: b.id, version: 1 },
          ],
          changes: { status: 'resolved' },
        });
      expect(bulk.status).toBe(200);
      const [tokenA, tokenB] = await Promise.all([tokenOf(a.id), tokenOf(b.id)]);
      expect(tokenA).not.toBe(tokenB);
      expect((await surveyRow(a.id))?.tokenHash).toBe(hashSurveyToken(tokenA));
      expect((await surveyRow(b.id))?.tokenHash).toBe(hashSurveyToken(tokenB));
    });

    it('CT-03 fechar (à mão ou pelo fechamento automático) não pede avaliação', async () => {
      await t.prisma.user.create({
        data: { email: SYSTEM_USER_EMAIL, name: 'Sistema', active: false },
      });
      const manual = await f.ticket({ requester: 'req1', status: 'resolved' });
      expect((await patch('sup', manual.id, { version: 1, status: 'closed' })).status).toBe(200);

      const auto = await f.ticket({ requester: 'req1', status: 'resolved' });
      await t.prisma.ticket.update({
        where: { id: auto.id },
        data: { resolvedAt: new Date(Date.now() - 8 * DAY_MS) },
      });
      expect(await t.app.get(TicketsService).closeExpiredResolved(7)).toBe(1);

      expect(await t.prisma.ticketSatisfaction.count()).toBe(0);
      expect(await t.prisma.notification.count()).toBe(0);
    });

    it('CT-04 terceiro recebe o link; inativo e agente que resolve o próprio chamado, não', async () => {
      const external = await f.ticket({ requester: 'ext1', company: 'U1' });
      await resolve(external.id, 1);
      const toExternal = await t.prisma.notification.findFirstOrThrow({
        where: { ticketId: external.id },
      });
      expect(toExternal.toEmail).toBe(email('ext1'));
      expect(payloadOf(toExternal).portalUrl).toBeNull();
      expect(payloadOf(toExternal).csatUrl).toEqual(expect.stringContaining('/avaliar#'));
      expect(await surveyRow(external.id)).not.toBeNull();

      await t.prisma.user.update({ where: { id: f.users.req2 }, data: { active: false } });
      const inactive = await f.ticket({ requester: 'req2' });
      await resolve(inactive.id, 1);
      expect(await surveyRow(inactive.id)).toBeNull();

      const own = await f.ticket({ requester: 'ag1' });
      await resolve(own.id, 1);
      expect(await surveyRow(own.id)).toBeNull();
    });

    it('CT-05 nova resolução troca o link; a nota dada continua até o link novo ser respondido', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      let version = await resolve(ticket.id, 1);
      const first = await tokenOf(ticket.id);
      expect((await rate({ token: first, score: 2 })).status).toBe(200);

      version = await reopen(ticket.id, version);
      await resolve(ticket.id, version);
      const second = await tokenOf(ticket.id);
      expect(second).not.toBe(first);

      const old = await lookup(first);
      expect(old.status).toBe(404);
      expect(old.body).toMatchObject({ code: 'SURVEY_LINK_INVALID' });
      const current = await lookup(second);
      expect(current.status).toBe(200);
      expect(surveyOf(current).score).toBe(2);
    });

    it('CT-06 nova resolução sem e-mail invalida o link anterior', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      let version = await resolve(ticket.id, 1);
      const first = await tokenOf(ticket.id);

      version = await reopen(ticket.id, version);
      await t.prisma.user.update({ where: { id: f.users.req1 }, data: { active: false } });
      await resolve(ticket.id, version);

      expect((await surveyRow(ticket.id))?.tokenHash).toBeNull();
      expect((await lookup(first)).status).toBe(404);
      expect(await t.prisma.notification.count({ where: { ticketId: ticket.id } })).toBe(1);
    });

    it('CT-07 link vencido não vale', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await resolve(ticket.id, 1);
      const token = await tokenOf(ticket.id);
      await t.prisma.ticketSatisfaction.update({
        where: { ticketId: ticket.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await lookup(token)).status).toBe(404);
      expect((await rate({ token, score: 5 })).status).toBe(404);
    });
  });

  describe('rotas públicas (RN-08 a RN-15)', () => {
    it('CT-09 lookup mostra o chamado sem gravar nada', async () => {
      const { ticket, token } = await resolvedWithLink();
      const res = await lookup(token);
      expect(res.status).toBe(200);
      expect(surveyOf(res)).toEqual({
        ticketNumber: ticket.number,
        ticketSubject: 'Impressora da secretaria',
        score: null,
        comment: null,
        ratedAt: null,
        expiresAt: expect.any(String),
      });
      expect((await surveyRow(ticket.id))?.ratedAt).toBeNull();
    });

    it('CT-10 grava, apara o comentário e permite alterar', async () => {
      const { ticket, token } = await resolvedWithLink();
      const first = await rate({ token, score: 4, comment: '  Resolveram rápido.  ' });
      expect(first.status).toBe(200);
      expect(surveyOf(first)).toMatchObject({ score: 4, comment: 'Resolveram rápido.' });
      const firstAt = surveyOf(first).ratedAt!;

      const second = await rate({ token, score: 2 });
      expect(second.status).toBe(200);
      expect(surveyOf(second)).toMatchObject({ score: 2, comment: null });
      expect(Date.parse(surveyOf(second).ratedAt!)).toBeGreaterThanOrEqual(Date.parse(firstAt));
      expect(await surveyRow(ticket.id)).toMatchObject({ score: 2, comment: null });
    });

    it('CT-11 nota fora de 1–5, fracionada, comentário longo ou sem token → 422', async () => {
      const { token } = await resolvedWithLink();
      for (const body of [
        { token, score: 0 },
        { token, score: 6 },
        { token, score: 3.5 },
        { token, score: 4, comment: 'x'.repeat(1001) },
        { score: 4 },
      ]) {
        const res = await rate(body);
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
      expect((await http().post('/api/satisfaction/lookup').send({})).status).toBe(422);
    });

    it('CT-12 token desconhecido → 404 SURVEY_LINK_INVALID', async () => {
      for (const res of [
        await lookup(UNKNOWN_TOKEN),
        await rate({ token: UNKNOWN_TOKEN, score: 3 }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'SURVEY_LINK_INVALID' });
      }
    });

    it('CT-13 avaliar não muda versão, updated_at nem o histórico do chamado', async () => {
      const { ticket, token } = await resolvedWithLink();
      const before = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      const events = await t.prisma.ticketEvent.count({ where: { ticketId: ticket.id } });

      expect((await rate({ token, score: 5 })).status).toBe(200);

      const after = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await t.prisma.ticketEvent.count({ where: { ticketId: ticket.id } })).toBe(events);
    });
  });

  describe('quem vê (RN-16)', () => {
    it('CT-14 só supervisor e admin recebem `satisfaction` no detalhe', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await resolve(ticket.id, 1);
      await rate({ token: await tokenOf(ticket.id), score: 4, comment: 'Bom' });

      for (const user of ['sup', 'adm'] as const) {
        const res = await detail(user, ticket.id);
        expect(res.status).toBe(200);
        expect(detailOf(res).satisfaction).toMatchObject({
          score: 4,
          comment: 'Bom',
          ratedAt: expect.any(String),
          requestedAt: expect.any(String),
          linkActive: true,
        });
      }
      for (const user of ['ag1', 'req1'] as const) {
        const res = await detail(user, ticket.id);
        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('satisfaction');
      }

      const never = await f.ticket({ requester: 'req1' });
      expect(detailOf(await detail('sup', never.id)).satisfaction).toBeNull();
    });
  });

  describe('relatórios (RN-19 a RN-22)', () => {
    it('CT-16 totais e coluna por agente pela data da avaliação, inclusive chamado antigo', async () => {
      await rated(5, '2026-10-10', '2026-10-09', { assignee: 'ag1' });
      await rated(2, '2026-10-12', '2026-10-11');
      // Avaliada antes do período; o link foi enviado no período e ainda não foi respondido de novo.
      await rated(1, '2026-09-20', '2026-10-15');
      // Avaliada depois do período: fora.
      await rated(4, '2026-11-02', '2026-09-30', { assignee: 'ag1' });

      const res = await http()
        .get(`/api/reports/summary?${OCTOBER}`)
        .set('Authorization', await as('sup'));
      expect(res.status).toBe(200);
      const summary = summaryOf(res);
      expect(summary.totals.satisfaction).toEqual({
        responses: 2,
        satisfied: 1,
        average: 3.5,
        requested: 3,
        answered: 2,
      });
      const agent = summary.byAgent.find((row) => row.id === f.users.ag1);
      expect(agent?.satisfaction).toMatchObject({ responses: 1, satisfied: 1, average: 5 });
    });

    it('CT-17 lista do período, só notas baixas e por grupo, da mais recente para a mais antiga', async () => {
      const low1 = await rated(1, '2026-10-05', '2026-10-04', { assignee: 'ag1' });
      const low2 = await rated(2, '2026-10-20', '2026-10-19');
      await rated(5, '2026-10-21', '2026-10-20');
      await rated(1, '2026-10-22', '2026-10-21', { group: 'G2' });
      await rated(null, null, '2026-10-10');

      const all = await http()
        .get(`/api/reports/satisfaction?${OCTOBER}`)
        .set('Authorization', await as('adm'));
      expect(all.status).toBe(200);
      expect(listOf(all).items.map((item) => item.score)).toEqual([1, 5, 2, 1]);

      const res = await http()
        .get(`/api/reports/satisfaction?${OCTOBER}&low=true&groupId=${f.G1}`)
        .set('Authorization', await as('sup'));
      expect(res.status).toBe(200);
      const list = listOf(res);
      expect(list.truncated).toBe(false);
      expect(list.items.map((item) => item.ticketId)).toEqual([low2.id, low1.id]);
      expect(list.items[1]).toMatchObject({
        ticketNumber: low1.number,
        ticketSubject: 'Ticket de teste',
        score: 1,
        comment: 'Nota 1',
        assignee: { id: f.users.ag1, name: 'ag1' },
        group: { id: f.G1, name: 'Grupo 1' },
      });
    });

    it('CT-17 acima de 500 avaliações, a lista corta e avisa', async () => {
      const total = 501;
      const created = await t.prisma.ticket.createManyAndReturn({
        data: Array.from({ length: total }, (_, n) => ({
          subject: `Chamado ${n}`,
          source: 'portal' as const,
          status: 'resolved' as const,
          requesterId: f.users.req1,
          groupId: f.G1,
          categoryId: f.C1,
          companyId: f.U1,
        })),
        select: { id: true },
      });
      await t.prisma.ticketSatisfaction.createMany({
        data: created.map(({ id }, n) => ({
          ticketId: id,
          requestedAt: noon('2026-10-01'),
          score: 4,
          ratedAt: new Date(noon('2026-10-02').getTime() + n * 60_000),
        })),
      });
      const res = await http()
        .get(`/api/reports/satisfaction?${OCTOBER}`)
        .set('Authorization', await as('sup'));
      expect(res.status).toBe(200);
      expect(listOf(res).items).toHaveLength(500);
      expect(listOf(res).truncated).toBe(true);
    });
  });
});
