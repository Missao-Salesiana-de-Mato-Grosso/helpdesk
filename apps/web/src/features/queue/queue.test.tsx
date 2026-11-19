// Spec docs/specs/T35-acoes-em-lote.md — seleção e ações em lote na fila do agente.
import type {
  BulkUpdateTicketsResponse,
  MeResponse,
  TicketListResponse,
  TicketSummary,
} from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../routes.tsx';
import { callsTo, jsonBody, stubApi, type Handler } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { CATEGORY, COMPANY, me, summary } from '../../test/tickets.ts';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const agent: MeResponse = {
  ...me,
  id: 'a1',
  name: 'João Agente',
  roles: ['agente'],
  isAgent: true,
  groups: [{ id: 'g1', name: 'Suporte TI' }],
};

const G1 = { id: 'g1', name: 'Suporte TI' };
const G2 = { id: 'g2', name: 'Sistemas' };

const ticket = (n: number, overrides: Partial<TicketSummary> = {}) =>
  summary({ id: `t${n}`, number: 1040 + n, subject: `Chamado ${n}`, ...overrides });

const listOf = (items: TicketSummary[], total = items.length): TicketListResponse => ({
  items,
  total,
  page: 1,
  pageSize: 25,
});

const base: Record<string, Handler> = {
  'GET /api/me': () => jsonResponse(200, agent),
  'GET /api/tickets/counters': () =>
    jsonResponse(200, { mine: 0, group: 3, unassigned: 3, noCompany: 0, slaBreached: 0 }),
  'GET /api/companies': () => jsonResponse(200, [COMPANY]),
  'GET /api/groups': () => jsonResponse(200, [G1, G2]),
  'GET /api/categories': () => jsonResponse(200, [CATEGORY]),
  'GET /api/groups/g1/members': () =>
    jsonResponse(200, [
      { id: 'a1', name: 'João Agente' },
      { id: 'a3', name: 'Ana Lima' },
    ]),
  'GET /api/groups/g2/members': () => jsonResponse(200, [{ id: 'a2', name: 'Pedro Souza' }]),
};

/** Os dois chamados do CT-25 alterados, com a versão nova. */
const bothOk = (version: number): BulkUpdateTicketsResponse => ({
  results: [
    { id: 't1', ok: true, number: 1041, changed: true, version },
    { id: 't2', ok: true, number: 1042, changed: true, version },
  ],
  succeeded: 2,
  failed: 0,
});

/** Abre a fila do grupo; cada GET da lista devolve a próxima resposta (a última se repete). */
function openQueue(lists: TicketListResponse[], extra: Record<string, Handler> = {}) {
  let call = 0;
  const fetchMock = stubApi({
    ...base,
    'GET /api/tickets': () => jsonResponse(200, lists[Math.min(call++, lists.length - 1)]),
    ...extra,
  });
  renderWithProviders(<AppRoutes />, { route: '/fila/grupo' });
  return fetchMock;
}

const box = (name: string) => screen.getByRole('checkbox', { name });
const bar = () => screen.queryByRole('region', { name: 'Ações em lote' });

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

async function optionsOf(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  const listbox = await screen.findByRole('listbox');
  return within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent);
}

async function applyChange(field: string, valueLabel: string, value: string) {
  await userEvent.click(within(bar()!).getByRole('button', { name: 'Alterar…' }));
  await choose('O que alterar', field);
  await choose(valueLabel, value);
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
}

describe('Fila — ações em lote (T35)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CT-20 marcar linhas, marcar a página e trocar de página limpa a seleção', async () => {
    openQueue([listOf([ticket(1), ticket(2), ticket(3)], 30)]);
    await screen.findByRole('link', { name: 'Chamado 1' });
    expect(bar()).not.toBeInTheDocument();

    await userEvent.click(box('Selecionar #1041'));
    await userEvent.click(box('Selecionar #1042'));
    expect(within(bar()!).getByText('2 selecionados')).toBeInTheDocument();
    const all = box('Selecionar todos da página');
    expect(all).not.toBeChecked();
    expect(all).toHaveAttribute('data-indeterminate', 'true');

    await userEvent.click(all);
    expect(within(bar()!).getByText('3 selecionados')).toBeInTheDocument();
    expect(box('Selecionar #1043')).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(box('Selecionar #1041')).not.toBeChecked();
  });

  it('CT-21 um campo por vez: trocar o campo descarta o valor; confirmação com o resumo', async () => {
    const response: BulkUpdateTicketsResponse = {
      results: [
        { id: 't1', ok: true, number: 1041, changed: true, version: 2 },
        { id: 't2', ok: true, number: 1042, changed: true, version: 2 },
      ],
      succeeded: 2,
      failed: 0,
    };
    const fetchMock = openQueue([listOf([ticket(1), ticket(2), ticket(3)])], {
      'PATCH /api/tickets/bulk': () => jsonResponse(200, response),
    });
    await screen.findByRole('link', { name: 'Chamado 1' });
    await userEvent.click(box('Selecionar #1041'));
    await userEvent.click(box('Selecionar #1042'));

    await userEvent.click(within(bar()!).getByRole('button', { name: 'Alterar…' }));
    const apply = screen.getByRole('button', { name: 'Aplicar' });
    expect(apply).toBeDisabled();
    await choose('O que alterar', 'Prioridade');
    expect(apply).toBeDisabled();
    await choose('Nova prioridade', 'Alta');
    expect(apply).toBeEnabled();

    await choose('O que alterar', 'Situação');
    expect(screen.getByRole('combobox', { name: 'Nova situação' })).toHaveValue('');
    expect(apply).toBeDisabled();
    await choose('Nova situação', 'Fechado');
    await userEvent.click(apply);

    expect(
      await screen.findByText('Alterar a situação de 2 chamados para Fechado?'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await screen.findByText('2 alterados');
    const [call] = callsTo(fetchMock, 'PATCH /api/tickets/bulk');
    expect(jsonBody(call?.[1])).toEqual({
      tickets: [
        { id: 't1', version: 1 },
        { id: 't2', version: 1 },
      ],
      changes: { status: 'closed' },
    });
  });

  it('CT-22 responsável: membros do grupo comum; grupos diferentes, só "Ninguém" e "Eu"', async () => {
    openQueue([listOf([ticket(1), ticket(2, { group: G2 })])]);
    await screen.findByRole('link', { name: 'Chamado 1' });
    await userEvent.click(box('Selecionar #1041'));

    await userEvent.click(within(bar()!).getByRole('button', { name: 'Alterar…' }));
    await choose('O que alterar', 'Responsável');
    expect(await optionsOf('Novo responsável')).toEqual(['Ninguém', 'Eu', 'Ana Lima']);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await userEvent.click(box('Selecionar #1042'));
    await userEvent.click(within(bar()!).getByRole('button', { name: 'Alterar…' }));
    await choose('O que alterar', 'Responsável');
    expect(await optionsOf('Novo responsável')).toEqual(['Ninguém', 'Eu']);
  });

  it('CT-23 resultado parcial: motivos em pt-BR e só os que seguem na página ficam marcados', async () => {
    const response: BulkUpdateTicketsResponse = {
      results: [
        { id: 't2', ok: true, number: 1042, changed: true, version: 2 },
        {
          id: 't10',
          ok: false,
          number: 1050,
          code: 'VERSION_CONFLICT',
          message: 'O ticket foi alterado por outra pessoa.',
        },
        { id: 't3', ok: false, code: 'NOT_FOUND', message: 'Ticket não encontrado.' },
      ],
      succeeded: 1,
      failed: 2,
    };
    const before = [ticket(2), ticket(10), ticket(3)];
    const after = [ticket(2, { priority: 'high', version: 2 }), ticket(10, { version: 3 })];
    openQueue([listOf(before), listOf(after)], {
      'PATCH /api/tickets/bulk': () => jsonResponse(200, response),
    });
    await screen.findByRole('link', { name: 'Chamado 2' });
    await userEvent.click(box('Selecionar todos da página'));
    await applyChange('Prioridade', 'Nova prioridade', 'Alta');

    expect(await screen.findByText('1 alterado')).toBeInTheDocument();
    expect(
      screen.getByText('#1050 — alterado por outra pessoa; confira e tente de novo'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chamado não encontrado ou fora do seu acesso')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Chamado 3' })).not.toBeInTheDocument(),
    );
    expect(box('Selecionar #1042')).toBeChecked();
    expect(box('Selecionar #1050')).toBeChecked();
    expect(within(bar()!).getByText('2 selecionados')).toBeInTheDocument();
  });

  it('CT-25 encadeia mover de grupo e atribuir sem remarcar, com as versões novas', async () => {
    let patches = 0;
    const fetchMock = openQueue(
      [
        listOf([ticket(1), ticket(2)]),
        listOf([ticket(1, { group: G2, version: 2 }), ticket(2, { group: G2, version: 2 })]),
        listOf([ticket(1, { group: G2, version: 3 }), ticket(2, { group: G2, version: 3 })]),
      ],
      { 'PATCH /api/tickets/bulk': () => jsonResponse(200, bothOk(++patches + 1)) },
    );
    await screen.findByRole('link', { name: 'Chamado 1' });
    await userEvent.click(box('Selecionar todos da página'));

    await applyChange('Grupo', 'Novo grupo', 'Sistemas');
    await screen.findByText('2 alterados');
    await waitFor(() => expect(screen.getAllByText('Sistemas')).toHaveLength(2));
    expect(within(bar()!).getByText('2 selecionados')).toBeInTheDocument();

    await userEvent.click(within(bar()!).getByRole('button', { name: 'Alterar…' }));
    await choose('O que alterar', 'Responsável');
    expect(await optionsOf('Novo responsável')).toEqual(['Ninguém', 'Eu', 'Pedro Souza']);
    await userEvent.click(await screen.findByRole('option', { name: 'Pedro Souza' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(callsTo(fetchMock, 'PATCH /api/tickets/bulk')).toHaveLength(2));
    const second = callsTo(fetchMock, 'PATCH /api/tickets/bulk')[1];
    expect(jsonBody(second?.[1])).toEqual({
      tickets: [
        { id: 't1', version: 2 },
        { id: 't2', version: 2 },
      ],
      changes: { assigneeId: 'a2' },
    });
  });
});
