import type { Holiday, MeResponse, SlaSettings, TicketSla } from '@helpdesk/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../routes.tsx';
import { jsonBody, stubApi, type Handler } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { COMPANY, page, summary } from '../../test/tickets.ts';
import { SlaBadge } from '../tickets/SlaBadge.tsx';
import { formatIntervals, parseIntervals } from './hours.ts';
import { SlaSettingsPage } from './SlaSettingsPage.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue(fakeAuth());
});

const ADMIN: MeResponse = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@missaosalesiana.org.br',
  roles: ['admin'],
  isAgent: true,
  company: COMPANY,
  department: { id: 'd1', name: 'Secretaria' },
  groups: [{ id: 'g1', name: 'Suporte TI' }],
  needsOnboarding: false,
  accessStatus: 'approved',
};

const SETTINGS: SlaSettings = {
  timeZone: 'America/Cuiaba',
  policies: [
    { priority: 'urgent', firstResponseMinutes: 60, resolutionMinutes: 240 },
    { priority: 'high', firstResponseMinutes: 240, resolutionMinutes: 480 },
    { priority: 'medium', firstResponseMinutes: 480, resolutionMinutes: 1440 },
    { priority: 'low', firstResponseMinutes: 960, resolutionMinutes: 2400 },
  ],
  hours: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 420, endMinute: 660 },
    { weekday, startMinute: 780, endMinute: 1020 },
  ]),
};

const NATAL: Holiday = { id: 'h1', date: '2026-12-25', name: 'Natal' };

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const show = (sla: TicketSla | null) =>
  render(
    <MantineProvider>
      <SlaBadge sla={sla} />
    </MantineProvider>,
  );

const routes = (calls: { route: string; body: unknown }[]): Record<string, Handler> => {
  const record =
    (route: string, response: () => Response): Handler =>
    (init) => {
      calls.push({ route, body: jsonBody(init) });
      return response();
    };
  return {
    'GET /api/me': () => jsonResponse(200, ADMIN),
    'GET /api/admin/sla': () => jsonResponse(200, SETTINGS),
    'GET /api/admin/holidays': () => jsonResponse(200, [NATAL]),
    'PUT /api/admin/sla/policies': record('policies', () => jsonResponse(200, SETTINGS)),
    'PUT /api/admin/sla/hours': record('hours', () => jsonResponse(200, SETTINGS)),
    'POST /api/admin/holidays': record('holiday', () =>
      jsonResponse(201, { id: 'h2', date: '2026-04-08', name: 'Aniversário de Cuiabá' }),
    ),
    'DELETE /api/admin/holidays/h1': record('delete', () => new Response(null, { status: 204 })),
  };
};

describe('horário: texto ↔ intervalos', () => {
  it('formata e lê de volta', () => {
    expect(formatIntervals(SETTINGS.hours, 1)).toBe('07:00–11:00, 13:00–17:00');
    expect(formatIntervals(SETTINGS.hours, 6)).toBe('');
    expect(parseIntervals('07:00-11:00, 13:00–17:00', 1)).toEqual({
      intervals: [
        { weekday: 1, startMinute: 420, endMinute: 660 },
        { weekday: 1, startMinute: 780, endMinute: 1020 },
      ],
    });
    expect(parseIntervals('', 0)).toEqual({ intervals: [] });
    expect(parseIntervals('00:00–24:00', 0)).toEqual({
      intervals: [{ weekday: 0, startMinute: 0, endMinute: 1440 }],
    });
  });

  it('recusa formato, fim antes do início e sobreposição', () => {
    expect(parseIntervals('7h às 11h', 1)).toHaveProperty('error');
    expect(parseIntervals('11:00–07:00', 1)).toHaveProperty('error');
    expect(parseIntervals('07:00–12:00, 11:00–17:00', 1)).toEqual({
      error: 'Há intervalos sobrepostos.',
    });
  });
});

describe('SlaBadge (T28)', () => {
  it('mostra a 1ª resposta enquanto não houver; depois a resolução', () => {
    show({
      firstResponse: { dueAt: minutesFromNow(30), doneAt: null },
      resolution: { dueAt: minutesFromNow(600), doneAt: null },
      pausedAt: null,
    });
    expect(screen.getByText('1ª resposta')).toBeInTheDocument();
    expect(screen.getByText('Vence em 30 min')).toBeInTheDocument();
  });

  it('vencida, pausada e sem SLA', () => {
    const { unmount } = show({
      firstResponse: { dueAt: minutesFromNow(-200), doneAt: minutesFromNow(-300) },
      resolution: { dueAt: minutesFromNow(-180), doneAt: null },
      pausedAt: null,
    });
    expect(screen.getByText('Resolução')).toBeInTheDocument();
    expect(screen.getByText('Vencido há 3 h')).toBeInTheDocument();
    unmount();

    show({
      firstResponse: null,
      resolution: { dueAt: minutesFromNow(60), doneAt: null },
      pausedAt: minutesFromNow(-5),
    });
    expect(screen.getByText('Pausado')).toBeInTheDocument();
  });
});

describe('fila: SLA vencido (T28)', () => {
  it('"SLA vencido (n)" filtra com slaBreached=true e a coluna Prazo aparece', async () => {
    const queries: URLSearchParams[] = [];
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/tickets/counters': () =>
        jsonResponse(200, { mine: 0, group: 1, unassigned: 0, noCompany: 0, slaBreached: 2 }),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/groups': () => jsonResponse(200, [{ id: 'g1', name: 'Suporte TI' }]),
      'GET /api/tickets': (_init, url) => {
        queries.push(url.searchParams);
        return jsonResponse(
          200,
          page([
            summary({
              status: 'open',
              sla: {
                firstResponse: { dueAt: '2026-01-01T12:00:00.000Z', doneAt: null },
                resolution: { dueAt: '2026-01-02T12:00:00.000Z', doneAt: null },
                pausedAt: null,
              },
            }),
          ]),
        );
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/fila/todos' });

    const link = await screen.findByRole('link', { name: 'Impressora da secretaria' });
    expect(screen.getByRole('columnheader', { name: 'Prazo' })).toBeInTheDocument();
    expect(within(link.closest('tr')!).getByText(/^Vencido há/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'SLA vencido (2)' }));
    await waitFor(() => expect(queries.at(-1)?.get('slaBreached')).toBe('true'));
  });
});

describe('SlaSettingsPage (T28)', () => {
  it('edita a meta em horas e envia em minutos', async () => {
    const calls: { route: string; body: unknown }[] = [];
    stubApi(routes(calls));
    renderWithProviders(<SlaSettingsPage />);

    const field = await screen.findByLabelText('1ª resposta — Urgente');
    expect(field).toHaveValue('1');
    await userEvent.clear(field);
    await userEvent.type(field, '0,5');
    const section = screen
      .getByRole('heading', { name: 'Metas por prioridade' })
      .closest('div')!.parentElement!;
    await userEvent.click(within(section).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(calls.map((call) => call.route)).toContain('policies'));
    const body = calls.find((call) => call.route === 'policies')?.body;
    expect(body).toContainEqual({
      priority: 'urgent',
      firstResponseMinutes: 30,
      resolutionMinutes: 240,
    });
    expect(body).toHaveLength(4);
  });

  it('horário: erro no campo bloqueia; sábado de manhã é enviado', async () => {
    const calls: { route: string; body: unknown }[] = [];
    stubApi(routes(calls));
    renderWithProviders(<SlaSettingsPage />);

    const saturday = await screen.findByLabelText('Sábado');
    const section = screen
      .getByRole('heading', { name: 'Horário comercial' })
      .closest('div')!.parentElement!;
    const save = within(section).getByRole('button', { name: 'Salvar' });

    await userEvent.type(saturday, '8h');
    expect(within(section).getByText(/Use o formato 07:00–11:00/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.clear(saturday);
    await userEvent.type(saturday, '07:00–11:00');
    await userEvent.click(save);
    await waitFor(() => expect(calls.map((call) => call.route)).toContain('hours'));
    expect(calls.find((call) => call.route === 'hours')?.body).toContainEqual({
      weekday: 6,
      startMinute: 420,
      endMinute: 660,
    });
  });

  it('feriados: lista, adiciona e exclui', async () => {
    const calls: { route: string; body: unknown }[] = [];
    stubApi(routes(calls));
    renderWithProviders(<SlaSettingsPage />);

    expect(await screen.findByText('Natal')).toBeInTheDocument();
    expect(screen.getByText('25/12/2026')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Data'), '2026-04-08');
    await userEvent.type(screen.getByLabelText('Nome'), 'Aniversário de Cuiabá');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        route: 'holiday',
        body: { date: '2026-04-08', name: 'Aniversário de Cuiabá' },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Excluir Natal (25/12/2026)' }));
    await waitFor(() => expect(calls.map((call) => call.route)).toContain('delete'));
  });
});
