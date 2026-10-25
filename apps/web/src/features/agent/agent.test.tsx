import type { MeResponse, TicketDetail } from '@helpdesk/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlEditorProps } from '../../components/HtmlEditor.tsx';
import { AppRoutes } from '../../routes.tsx';
import { callsTo, jsonBody, stubApi, type Handler } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { CATEGORY, COMPANY, TICKET_ID, detail, me, page, summary } from '../../test/tickets.ts';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

// O ProseMirror não aceita digitação pelo jsdom; o editor real tem teste próprio (HtmlEditor.test).
vi.mock('../../components/HtmlEditor.tsx', () => ({
  HtmlEditor: ({ label, value, onChange, error }: HtmlEditorProps) => (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      {error && <span>{error}</span>}
    </label>
  ),
}));

const agent: MeResponse = {
  ...me,
  id: 'a1',
  name: 'João Agente',
  roles: ['agente'],
  isAgent: true,
  groups: [{ id: 'g1', name: 'Suporte TI' }],
};

const GROUPS = [
  { id: 'g1', name: 'Suporte TI' },
  { id: 'g2', name: 'Sistemas' },
];
const COUNTERS = { mine: 1, group: 2, unassigned: 1, noCompany: 1 };
const conflict = () =>
  jsonResponse(409, {
    statusCode: 409,
    code: 'VERSION_CONFLICT',
    message: 'O ticket foi alterado por outra pessoa.',
    currentVersion: 2,
  });

const base: Record<string, Handler> = {
  'GET /api/me': () => jsonResponse(200, agent),
  'GET /api/tickets/counters': () => jsonResponse(200, COUNTERS),
  'GET /api/companies': () => jsonResponse(200, [COMPANY]),
  'GET /api/groups': () => jsonResponse(200, GROUPS),
  'GET /api/groups/g1/members': () => jsonResponse(200, [{ id: 'a1', name: 'João Agente' }]),
  'GET /api/categories': () => jsonResponse(200, [CATEGORY]),
};

function openTicket(ticket: TicketDetail, extra: Record<string, Handler> = {}) {
  const fetchMock = stubApi({
    ...base,
    [`GET /api/tickets/${ticket.id}`]: () => jsonResponse(200, ticket),
    ...extra,
  });
  renderWithProviders(<AppRoutes />, { route: `/tickets/${ticket.id}` });
  return fetchMock;
}

const combobox = (label: string) => screen.getByRole('combobox', { name: new RegExp(`^${label}`) });
async function choose(label: string, option: string) {
  await userEvent.click(combobox(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

function openQueue(slug: string) {
  const queries: URLSearchParams[] = [];
  stubApi({
    ...base,
    'GET /api/tickets': (_init, url) => {
      queries.push(url.searchParams);
      return jsonResponse(
        200,
        page([
          summary({
            company: null,
            requester: { id: 'x1', name: 'Fornecedor', isExternal: true },
          }),
        ]),
      );
    },
  });
  renderWithProviders(<AppRoutes />, { route: `/fila/${slug}` });
  return queries;
}

describe('Agente — filas e detalhe (T12)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('filas', () => {
    it('cada fila pede o view certo, com abertos e pendentes por padrão', async () => {
      const queries = openQueue('grupo');
      await screen.findByRole('link', { name: 'Impressora da secretaria' });
      expect(queries.at(-1)?.get('view')).toBe('group');
      expect(queries.at(-1)?.getAll('status')).toEqual(['open', 'pending']);
      expect(queries.at(-1)?.get('sort')).toBe('updated_at:desc');
    });

    it('linha sem unidade mostra o selo "Sem unidade"; terceiro tem selo', async () => {
      openQueue('meus');
      const link = await screen.findByRole('link', { name: 'Impressora da secretaria' });
      const row = link.closest('tr');
      expect(row).not.toBeNull();
      expect(within(row!).getByText('Sem unidade')).toBeInTheDocument();
      expect(within(row!).getByText('Terceiro')).toBeInTheDocument();
    });

    it('"Sem unidade (n)" filtra com noCompany=true; unidade filtra com companyId', async () => {
      const queries = openQueue('todos');
      await screen.findByRole('link', { name: 'Impressora da secretaria' });
      await choose('Unidade', COMPANY.name);
      await waitFor(() => expect(queries.at(-1)?.get('companyId')).toBe(COMPANY.id));
      await userEvent.click(await screen.findByRole('button', { name: 'Sem unidade (1)' }));
      await waitFor(() => expect(queries.at(-1)?.get('noCompany')).toBe('true'));
      expect(queries.at(-1)?.get('companyId')).toBeNull();
    });
  });

  describe('painel lateral', () => {
    it('mudar a prioridade envia PATCH só com o campo e a version', async () => {
      let body: unknown;
      openTicket(detail(), {
        [`PATCH /api/tickets/${TICKET_ID}`]: (init) => {
          body = jsonBody(init);
          return jsonResponse(200, detail({ priority: 'high', version: 2 }));
        },
      });
      await screen.findByRole('heading', { name: /#1001/ });
      await choose('Prioridade', 'Alta');
      await waitFor(() => expect(body).toEqual({ version: 1, priority: 'high' }));
      await waitFor(() => expect(combobox('Prioridade')).toHaveValue('Alta'));
    });

    it('Assumir atribui ao próprio agente', async () => {
      let body: unknown;
      openTicket(detail(), {
        [`PATCH /api/tickets/${TICKET_ID}`]: (init) => {
          body = jsonBody(init);
          return jsonResponse(
            200,
            detail({ assignee: { id: 'a1', name: 'João Agente' }, version: 2 }),
          );
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Assumir' }));
      await waitFor(() => expect(body).toEqual({ version: 1, assigneeId: 'a1' }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Assumir' })).not.toBeInTheDocument(),
      );
    });

    it('409: mostra o aviso e recarrega o ticket, mantendo o rascunho', async () => {
      const fetchMock = openTicket(detail(), {
        [`PATCH /api/tickets/${TICKET_ID}`]: conflict,
      });
      await screen.findByRole('heading', { name: /#1001/ });
      await userEvent.type(screen.getByLabelText('Resposta ao solicitante'), 'Rascunho');
      const loads = callsTo(fetchMock, `GET /api/tickets/${TICKET_ID}`).length;
      await choose('Prioridade', 'Alta');
      expect(
        await screen.findByText(/Este chamado foi alterado por outra pessoa/),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(callsTo(fetchMock, `GET /api/tickets/${TICKET_ID}`).length).toBeGreaterThan(loads),
      );
      expect(screen.getByLabelText('Resposta ao solicitante')).toHaveValue('Rascunho');
    });

    it('resolver sem unidade: erro no campo Unidade, foco nele e nenhum PATCH', async () => {
      const fetchMock = openTicket(detail({ company: null }));
      await screen.findByRole('heading', { name: /#1001/ });
      await choose('Situação', 'Resolvido');
      expect(
        await screen.findByText('Defina a unidade antes de resolver ou fechar o chamado.'),
      ).toBeInTheDocument();
      expect(combobox('Unidade')).toHaveFocus();
      expect(callsTo(fetchMock, `PATCH /api/tickets/${TICKET_ID}`)).toHaveLength(0);
    });

    it('COMPANY_REQUIRED vindo da API também mostra o erro e foca a Unidade', async () => {
      openTicket(detail(), {
        [`PATCH /api/tickets/${TICKET_ID}`]: () =>
          jsonResponse(422, {
            statusCode: 422,
            code: 'COMPANY_REQUIRED',
            message: 'Defina a unidade do ticket antes de resolvê-lo ou fechá-lo.',
          }),
      });
      await screen.findByRole('heading', { name: /#1001/ });
      await choose('Situação', 'Fechado');
      expect(
        await screen.findByText('Defina a unidade antes de resolver ou fechar o chamado.'),
      ).toBeInTheDocument();
      expect(combobox('Unidade')).toHaveFocus();
    });

    it('solicitante sem unidade: opção de gravar no cadastro, enviada com a unidade', async () => {
      let body: unknown;
      const ticket = detail({
        company: null,
        requester: { ...detail().requester, company: null },
      });
      openTicket(ticket, {
        [`PATCH /api/tickets/${TICKET_ID}`]: (init) => {
          body = jsonBody(init);
          return jsonResponse(200, detail({ version: 2 }));
        },
      });
      expect(
        await screen.findByRole('checkbox', { name: 'Gravar também no cadastro do solicitante' }),
      ).toBeChecked();
      await choose('Unidade', COMPANY.name);
      await waitFor(() =>
        expect(body).toEqual({ version: 1, companyId: COMPANY.id, applyCompanyToRequester: true }),
      );
    });

    it('solicitante com unidade: sem a opção de gravar no cadastro', async () => {
      openTicket(detail({ company: null }));
      await screen.findByRole('heading', { name: /#1001/ });
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });

  describe('mensagens e histórico', () => {
    it('nota interna envia kind internal', async () => {
      let body: unknown;
      openTicket(detail(), {
        [`POST /api/tickets/${TICKET_ID}/messages`]: (init) => {
          body = jsonBody(init);
          return jsonResponse(201, detail());
        },
      });
      await userEvent.click(await screen.findByRole('tab', { name: 'Nota interna' }));
      await userEvent.type(
        screen.getByLabelText('Nota interna (só a equipe vê)'),
        'Verificar cabo',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
      await waitFor(() => expect(body).toEqual({ kind: 'internal', bodyHtml: 'Verificar cabo' }));
    });

    it('"Enviar e marcar como Pendente" envia status e version', async () => {
      let body: unknown;
      openTicket(detail(), {
        [`POST /api/tickets/${TICKET_ID}/messages`]: (init) => {
          body = jsonBody(init);
          return jsonResponse(201, detail({ status: 'pending', version: 2 }));
        },
      });
      await userEvent.type(
        await screen.findByLabelText('Resposta ao solicitante'),
        'Aguardo seu retorno',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Enviar e mudar a situação' }));
      await userEvent.click(
        await screen.findByRole('menuitem', { name: 'Enviar e marcar como Pendente' }),
      );
      await waitFor(() =>
        expect(body).toEqual({
          kind: 'public',
          bodyHtml: 'Aguardo seu retorno',
          status: 'pending',
          version: 1,
        }),
      );
      expect(screen.getByLabelText('Resposta ao solicitante')).toHaveValue('');
    });

    it('histórico mostra os eventos em pt-BR com os nomes de refs', async () => {
      openTicket(
        detail({
          events: [
            {
              id: '1',
              type: 'status_changed',
              actor: { id: 'a1', name: 'João Agente' },
              data: { from: 'open', to: 'pending' },
              createdAt: '2026-10-24T12:00:00.000Z',
            },
            {
              id: '2',
              type: 'assigned',
              actor: { id: 'a1', name: 'João Agente' },
              data: { from: null, to: 'u9' },
              createdAt: '2026-10-24T12:05:00.000Z',
            },
          ],
          refs: { u9: 'Ana Souza' },
        }),
      );
      await userEvent.click(await screen.findByRole('tab', { name: 'Histórico' }));
      const history = screen.getByRole('tabpanel', { name: 'Histórico' });
      expect(history).toHaveTextContent('João Agente mudou a situação de Aberto para Pendente');
      expect(history).toHaveTextContent('João Agente atribuiu a Ana Souza');
    });

    it('o detalhe é recarregado a cada 30 s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = openTicket(detail());
      await screen.findByRole('heading', { name: /#1001/ });
      const loads = callsTo(fetchMock, `GET /api/tickets/${TICKET_ID}`).length;
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      await waitFor(() =>
        expect(callsTo(fetchMock, `GET /api/tickets/${TICKET_ID}`).length).toBe(loads + 1),
      );
    });
  });
});
