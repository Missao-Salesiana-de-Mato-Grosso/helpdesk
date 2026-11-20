// Spec docs/specs/T37-relatorios.md — tela de relatórios.
import type { MeResponse, ReportMetrics, ReportRow, ReportSummary } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../routes.tsx';
import { stubApi } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { me } from '../../test/tickets.ts';
import { formatDuration, presetRange, reportCsv } from './report-format.ts';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const supervisor: MeResponse = {
  ...me,
  id: 's1',
  name: 'Sara Supervisora',
  roles: ['supervisor'],
  isAgent: true,
  groups: [],
};

const metrics = (overrides: Partial<ReportMetrics> = {}): ReportMetrics => ({
  created: 0,
  resolved: 0,
  closed: 0,
  firstResponse: { median: null, average: null, count: 0 },
  resolution: { median: null, average: null, count: 0 },
  firstResponseSla: { met: 0, evaluated: 0 },
  resolutionSla: { met: 0, evaluated: 0 },
  ...overrides,
});

const row = (
  id: string | null,
  name: string,
  overrides: Partial<ReportMetrics> = {},
): ReportRow => ({
  id,
  name,
  active: true,
  ...metrics(overrides),
});

const summary = (from: string, to: string): ReportSummary => ({
  from,
  to,
  groupId: null,
  bucket: 'day',
  totals: {
    ...metrics({
      created: 12,
      resolved: 9,
      closed: 4,
      firstResponse: { median: 125, average: 200, count: 10 },
      resolution: { median: 1500, average: 1600, count: 9 },
      firstResponseSla: { met: 8, evaluated: 10 },
      resolutionSla: { met: 6, evaluated: 9 },
    }),
    openNow: 5,
  },
  series: [
    { date: from, created: 3, resolved: 1 },
    { date: to, created: 2, resolved: 4 },
  ],
  byGroup: [row('g1', 'Suporte TI', { created: 12 })],
  byAgent: [
    row('a1', 'Ana Lima', {
      created: 7,
      resolved: 5,
      firstResponse: { median: 45, average: 50, count: 5 },
      firstResponseSla: { met: 2, evaluated: 3 },
    }),
    { ...row('a2', 'Pedro; "Souza"', { created: 3 }), active: false },
    row(null, 'Sem responsável', { created: 2 }),
  ],
  byCompany: [],
  byCategory: [],
  bySource: [
    { source: 'portal', count: 6 },
    { source: 'agent', count: 2 },
    { source: 'email', count: 4 },
  ],
  byPriority: [
    { priority: 'low', count: 1 },
    { priority: 'medium', count: 8 },
    { priority: 'high', count: 2 },
    { priority: 'urgent', count: 1 },
  ],
});

function openReports(user: MeResponse = supervisor) {
  const calls: string[] = [];
  stubApi({
    'GET /api/me': () => jsonResponse(200, user),
    'GET /api/tickets/counters': () =>
      jsonResponse(200, { mine: 0, group: 0, unassigned: 0, noCompany: 0, slaBreached: 0 }),
    'GET /api/groups': () => jsonResponse(200, [{ id: 'g1', name: 'Suporte TI' }]),
    'GET /api/reports/summary': (_init, url) => {
      calls.push(`${url.pathname}${url.search}`);
      const params = url.searchParams;
      return jsonResponse(200, summary(params.get('from') ?? '', params.get('to') ?? ''));
    },
  });
  renderWithProviders(<AppRoutes />, { route: '/relatorios' });
  return calls;
}

describe('relatórios — formatação (T37)', () => {
  it('CT-06 tempos em minutos úteis', () => {
    expect(formatDuration(45)).toBe('45min');
    expect(formatDuration(125)).toBe('2h 5min');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(1500)).toBe('1d 1h');
    expect(formatDuration(null)).toBe('—');
  });

  it('atalhos de período', () => {
    const today = new Date(2026, 10, 20);
    expect(presetRange('7d', today)).toEqual({ from: '2026-11-14', to: '2026-11-20' });
    expect(presetRange('30d', today)).toEqual({ from: '2026-10-22', to: '2026-11-20' });
    expect(presetRange('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('lastMonth', new Date(2026, 0, 15))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('CT-16 CSV com BOM, ";", minutos inteiros e percentual com vírgula', () => {
    const csv = reportCsv('Agente', summary('2026-11-01', '2026-11-30').byAgent);
    const [header, ana, pedro] = csv.slice(1).split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(header).toBe(
      'Agente;Criados;Resolvidos;Fechados;1ª resposta (mediana, min úteis);Resolução (mediana, min úteis);1ª resposta no prazo (%);Resolução no prazo (%)',
    );
    expect(ana).toBe('Ana Lima;7;5;0;45;;66,7;');
    expect(pedro).toBe('"Pedro; ""Souza"" (inativo)";3;0;0;;;;');
  });
});

describe('ReportsPage (T37)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CT-14 cartões, distribuição e quebras; período padrão de 30 dias', async () => {
    const calls = openReports();
    expect(await screen.findByText('2h 5min')).toBeInTheDocument();
    const { from, to } = presetRange('30d', new Date());
    expect(calls[0]).toBe(`/api/reports/summary?from=${from}&to=${to}`);
    expect(screen.getByText('Em aberto agora').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('1d 1h')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('8 de 10 no prazo')).toBeInTheDocument();

    const channels = screen.getByRole('table', { name: 'Criados por canal' });
    expect(within(channels).getByText('E-mail').closest('tr')).toHaveTextContent('E-mail433%');

    await userEvent.click(screen.getByRole('tab', { name: 'Por agente' }));
    const agents = await screen.findByRole('table', { name: 'Por agente' });
    expect(within(agents).getByText('Pedro; "Souza" (inativo)')).toBeInTheDocument();
    expect(within(agents).getByText('Sem responsável')).toBeInTheDocument();
  });

  it('CT-15 atalho "Mês anterior" e filtro de grupo refazem a consulta', async () => {
    const calls = openReports();
    await screen.findByText('2h 5min');
    await userEvent.click(screen.getByText('Mês anterior'));
    const { from, to } = presetRange('lastMonth', new Date());
    await waitFor(() => expect(calls.at(-1)).toBe(`/api/reports/summary?from=${from}&to=${to}`));

    await userEvent.click(screen.getByRole('combobox', { name: 'Grupo' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Suporte TI' }));
    await waitFor(() =>
      expect(calls.at(-1)).toBe(`/api/reports/summary?from=${from}&to=${to}&groupId=g1`),
    );
  });

  it('CT-16 "Baixar CSV" gera o arquivo da quebra', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:relatorio');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    openReports();
    await userEvent.click(await screen.findByRole('tab', { name: 'Por agente' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar CSV' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0];
    if (!(link instanceof HTMLAnchorElement)) throw new Error('esperava um link');
    expect(link.download).toMatch(/^relatorio-agentes-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('CT-17 agente não vê o menu nem a tela', async () => {
    openReports({ ...supervisor, roles: ['agente'] });
    expect(await screen.findByText('Sem permissão')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Relatórios' })).not.toBeInTheDocument();
  });
});
