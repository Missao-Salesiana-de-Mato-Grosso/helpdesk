// Spec docs/specs/T37-relatorios.md — GET /api/reports/summary.
import type { ReportSummary } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import type { Prisma } from '../src/generated/prisma/client.js';
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
const summaryOf = (res: Response) => res.body as ReportSummary;

/** Meio-dia em Cuiabá (UTC−4): longe da virada do dia no fuso do horário comercial. */
const noon = (date: string) => new Date(`${date}T16:00:00Z`);

const OCTOBER = '?from=2026-10-01&to=2026-10-31';

describe('relatórios, T37 (e2e)', () => {
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
  const get = async (query: string, user: Login = 'sup') =>
    http()
      .get(`/api/reports/summary${query}`)
      .set('Authorization', `Bearer ${await f.token(user)}`);

  /** Chamado da fixture com as datas e campos do cenário. */
  const ticket = async (options: TicketOptions, data: Prisma.TicketUpdateInput) => {
    const created = await f.ticket(options);
    await t.prisma.ticket.update({ where: { id: created.id }, data });
    return created;
  };

  /**
   * Outubro: A criado, resolvido e fechado; B fechado direto; C criado em setembro e resolvido em
   * outubro; D criado em novembro (fora) e aberto; E criado e aberto, no G2, por e-mail, urgente.
   */
  async function scenario() {
    await ticket(
      { requester: 'req1', assignee: 'ag1', status: 'closed', subject: 'Assunto secreto A' },
      {
        createdAt: noon('2026-10-05'),
        resolvedAt: noon('2026-10-06'),
        closedAt: noon('2026-10-08'),
      },
    );
    await ticket(
      { requester: 'req1', assignee: 'ag1', status: 'closed' },
      { createdAt: noon('2026-10-10'), closedAt: noon('2026-10-11'), source: 'agent' },
    );
    await ticket(
      { requester: 'ext1', status: 'resolved' },
      { createdAt: noon('2026-09-20'), resolvedAt: noon('2026-10-03') },
    );
    await ticket({ requester: 'req1' }, { createdAt: noon('2026-11-05') });
    await ticket(
      { requester: 'req2', group: 'G2', assignee: 'ag2', priority: 'urgent' },
      { createdAt: noon('2026-10-15'), source: 'email' },
    );
  }

  it('CT-07 volume do período e em aberto agora; fechado direto não é resolvido', async () => {
    await scenario();
    const res = await get(OCTOBER);
    expect(res.status).toBe(200);
    expect(summaryOf(res).totals).toMatchObject({ created: 3, resolved: 2, closed: 2, openNow: 2 });
    expect(summaryOf(res).bucket).toBe('day');
    expect(summaryOf(res).series).toHaveLength(31);
    expect(summaryOf(res).series.find((p) => p.date === '2026-10-05')).toEqual({
      date: '2026-10-05',
      created: 1,
      resolved: 0,
    });
  });

  it('CT-08 filtro de grupo vale para totais, série e quebras', async () => {
    await scenario();
    const body = summaryOf(await get(`${OCTOBER}&groupId=${f.G1}`));
    expect(body.totals).toMatchObject({ created: 2, resolved: 2, openNow: 1 });
    expect(body.byGroup.map((row) => row.id)).toEqual([f.G1]);
    expect(body.series.reduce((sum, p) => sum + p.created, 0)).toBe(2);
  });

  it('CT-09 quebras por agente e unidade, com "Sem responsável" e "Sem unidade"', async () => {
    await scenario();
    const body = summaryOf(await get(OCTOBER));
    expect(body.byAgent.map((row) => [row.name, row.created])).toEqual([
      ['ag1', 2],
      ['ag2', 1],
      ['Sem responsável', 0],
    ]);
    expect(body.byAgent.find((row) => row.id === null)?.resolved).toBe(1);
    expect(body.byCompany.find((row) => row.id === null)).toMatchObject({
      name: 'Sem unidade',
      resolved: 1,
    });
    expect(body.byGroup.find((row) => row.id === f.G2)).toMatchObject({ created: 1, active: true });
  });

  it('CT-10 criados por canal e por prioridade', async () => {
    await scenario();
    const body = summaryOf(await get(OCTOBER));
    expect(body.bySource).toEqual([
      { source: 'portal', count: 1 },
      { source: 'agent', count: 1 },
      { source: 'email', count: 1 },
    ]);
    expect(body.byPriority).toEqual([
      { priority: 'low', count: 0 },
      { priority: 'medium', count: 2 },
      { priority: 'high', count: 0 },
      { priority: 'urgent', count: 1 },
    ]);
  });

  it('CT-11 agente e solicitante não acessam', async () => {
    expect((await get(OCTOBER, 'ag1')).status).toBe(403);
    expect((await get(OCTOBER, 'req1')).status).toBe(403);
  });

  it('CT-12 período invertido, acima de 366 dias ou data inexistente → 422', async () => {
    for (const query of [
      '?from=2026-10-31&to=2026-10-01',
      '?from=2025-01-01&to=2026-02-04',
      '?from=2026-02-30&to=2026-03-01',
    ]) {
      const res = await get(query);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('CT-13 só números e nomes de cadastros: sem assunto nem solicitante', async () => {
    await scenario();
    const text = JSON.stringify(summaryOf(await get(OCTOBER)));
    expect(text).not.toContain('Assunto secreto');
    expect(text).not.toContain('req1');
    expect(text).not.toContain('@missaosalesiana.org.br');
  });
});
