import type { TicketDetail } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlEditorProps } from '../../components/HtmlEditor.tsx';
import { AppRoutes } from '../../routes.tsx';
import { jsonBody, stubApi, type Handler } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import {
  CATEGORY,
  COMPANY,
  OLD_ID,
  OTHER_COMPANY,
  TICKET_ID,
  detail,
  me,
  message,
  page,
  summary,
} from '../../test/tickets.ts';

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

const formRoutes: Record<string, Handler> = {
  'GET /api/me': () => jsonResponse(200, me),
  'GET /api/categories': () => jsonResponse(200, [CATEGORY]),
  'GET /api/companies': () => jsonResponse(200, [COMPANY, OTHER_COMPANY]),
};

const detailRoutes = (ticket: TicketDetail, extra: Record<string, Handler> = {}) => ({
  'GET /api/me': () => jsonResponse(200, me),
  [`GET /api/tickets/${ticket.id}`]: () => jsonResponse(200, ticket),
  ...extra,
});

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(`^${label}`) }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

async function fillForm() {
  await userEvent.type(await screen.findByLabelText(/^Assunto/), 'Impressora da secretaria');
  await choose('Categoria', CATEGORY.name);
  await userEvent.type(screen.getByLabelText('Descrição'), 'Desde ontem não imprime');
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));
const posts = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('Solicitante — tickets (T11)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('novo ticket', () => {
    it('CT-01 assunto curto mostra o erro do schema e não envia', async () => {
      const fetchMock = stubApi(formRoutes);
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      await userEvent.type(await screen.findByLabelText(/^Assunto/), 'ab');
      await submit();
      expect(screen.getByText('O assunto precisa de ao menos 3 caracteres')).toBeInTheDocument();
      expect(posts(fetchMock)).toHaveLength(0);
    });

    it('CT-02 sem categoria → "Escolha a categoria"', async () => {
      stubApi(formRoutes);
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      await userEvent.type(await screen.findByLabelText(/^Assunto/), 'Impressora');
      await submit();
      expect(screen.getByText('Escolha a categoria')).toBeInTheDocument();
    });

    it('CT-03 descrição vazia → "Escreva a mensagem"', async () => {
      const fetchMock = stubApi(formRoutes);
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      await userEvent.type(await screen.findByLabelText(/^Assunto/), 'Impressora');
      await choose('Categoria', CATEGORY.name);
      await submit();
      expect(screen.getByText('Escreva a mensagem')).toBeInTheDocument();
      expect(posts(fetchMock)).toHaveLength(0);
    });

    it('CT-04 unidade pré-preenchida com a do cadastro', async () => {
      stubApi(formRoutes);
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: /^Unidade/ })).toHaveValue(COMPANY.name),
      );
    });

    it('CT-05 mostra o aviso LGPD', async () => {
      stubApi(formRoutes);
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      expect(
        await screen.findByText(
          /Não inclua dados pessoais de alunos, atendidos ou informações de saúde/,
        ),
      ).toBeInTheDocument();
    });

    it('CT-06 envia o corpo do schema e abre o detalhe do chamado criado', async () => {
      let body: unknown;
      stubApi({
        ...formRoutes,
        'POST /api/tickets': (init) => {
          body = jsonBody(init);
          return jsonResponse(201, detail());
        },
      });
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      await fillForm();
      await choose('Unidade', OTHER_COMPANY.name);
      await submit();
      expect(
        await screen.findByRole('heading', { name: '#1001 · Impressora da secretaria' }),
      ).toBeInTheDocument();
      expect(body).toEqual({
        subject: 'Impressora da secretaria',
        bodyHtml: 'Desde ontem não imprime',
        categoryId: CATEGORY.id,
        companyId: OTHER_COMPANY.id,
        priority: 'medium',
      });
    });

    it('CT-07 erro da API aparece e o formulário mantém o que foi digitado', async () => {
      stubApi({
        ...formRoutes,
        'POST /api/tickets': () =>
          jsonResponse(422, {
            statusCode: 422,
            code: 'INACTIVE_REFERENCE',
            message: 'Categoria inexistente ou inativa.',
          }),
      });
      renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
      await fillForm();
      await submit();
      expect(await screen.findByText('Categoria inexistente ou inativa.')).toBeInTheDocument();
      expect(screen.getByLabelText(/^Assunto/)).toHaveValue('Impressora da secretaria');
    });
  });

  describe('meus tickets', () => {
    it('CT-08 lista com situação em pt-BR, link pelo id e filtro padrão "em andamento"', async () => {
      let query: URLSearchParams | undefined;
      stubApi({
        'GET /api/me': () => jsonResponse(200, me),
        'GET /api/tickets': (_init, url) => {
          query = url.searchParams;
          return jsonResponse(200, page([summary()]));
        },
      });
      renderWithProviders(<AppRoutes />, { route: '/tickets' });
      const link = await screen.findByRole('link', { name: 'Impressora da secretaria' });
      expect(link).toHaveAttribute('href', `/tickets/${TICKET_ID}`);
      const row = link.closest('tr')!;
      expect(within(row).getByText('#1001')).toBeInTheDocument();
      expect(within(row).getByText('Pendente')).toBeInTheDocument();
      expect(query?.get('view')).toBe('requested');
      expect(query?.getAll('status')).toEqual(['open', 'pending']);
    });

    it('CT-09 sem chamados: mensagem e botão para abrir', async () => {
      stubApi({
        'GET /api/me': () => jsonResponse(200, me),
        'GET /api/tickets': () => jsonResponse(200, page([])),
      });
      renderWithProviders(<AppRoutes />, { route: '/tickets' });
      await userEvent.click(await screen.findByText('Todos'));
      expect(await screen.findByText('Você ainda não abriu chamados.')).toBeInTheDocument();
    });
  });

  describe('detalhe', () => {
    it('CT-10 conversa com selo do suporte e texto citado recolhido', async () => {
      const ticket = detail({
        messages: [
          message(),
          message({
            id: 'm2',
            bodyHtml: '<p>Pode verificar o cabo?</p>',
            quotedHtml: '<p>Mensagem anterior</p>',
            author: { id: 'a1', name: 'João Agente', isAgent: true },
          }),
        ],
      });
      stubApi(detailRoutes(ticket));
      renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });
      expect(await screen.findByText('A impressora não liga.')).toBeInTheDocument();
      expect(screen.getByText('Suporte')).toBeInTheDocument();
      expect(screen.queryByText('Mensagem anterior')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Mostrar texto citado' }));
      expect(screen.getByText('Mensagem anterior')).toBeInTheDocument();
    });

    it('CT-11 resposta envia mensagem pública e atualiza a conversa', async () => {
      let body: unknown;
      const ticket = detail({ status: 'resolved' });
      stubApi(
        detailRoutes(ticket, {
          [`POST /api/tickets/${TICKET_ID}/messages`]: (init) => {
            body = jsonBody(init);
            return jsonResponse(
              201,
              detail({
                status: 'open',
                messages: [message(), message({ id: 'm2', bodyHtml: '<p>Ainda não funciona</p>' })],
              }),
            );
          },
        }),
      );
      renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });
      expect(await screen.findByText(/responda abaixo e ele será reaberto/)).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Sua resposta'), 'Ainda não funciona');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));
      expect(await screen.findByText('Ainda não funciona')).toBeInTheDocument();
      expect(body).toEqual({ kind: 'public', bodyHtml: 'Ainda não funciona' });
      expect(screen.getByLabelText('Sua resposta')).toHaveValue('');
    });

    it('CT-12 fechado: sem resposta, com novo chamado relacionado que envia relatedTicketId', async () => {
      let body: unknown;
      const closed = detail({ id: OLD_ID, status: 'closed' });
      stubApi({
        ...formRoutes,
        ...detailRoutes(closed),
        'POST /api/tickets': (init) => {
          body = jsonBody(init);
          return jsonResponse(201, detail());
        },
        [`GET /api/tickets/${TICKET_ID}`]: () => jsonResponse(200, detail()),
      });
      renderWithProviders(<AppRoutes />, { route: `/tickets/${OLD_ID}` });
      await userEvent.click(
        await screen.findByRole('link', { name: 'Abrir novo chamado relacionado' }),
      );
      expect(screen.queryByLabelText('Sua resposta')).not.toBeInTheDocument();
      expect(await screen.findByText('Relacionado ao chamado #1001')).toBeInTheDocument();
      await fillForm();
      await submit();
      await screen.findByRole('heading', { name: '#1001 · Impressora da secretaria' });
      expect(body).toMatchObject({ relatedTicketId: OLD_ID });
    });

    it('CT-13 fora do escopo ou inexistente → "Chamado não encontrado"', async () => {
      stubApi({
        'GET /api/me': () => jsonResponse(200, me),
        [`GET /api/tickets/${TICKET_ID}`]: () =>
          jsonResponse(404, {
            statusCode: 404,
            code: 'NOT_FOUND',
            message: 'Ticket não encontrado.',
          }),
      });
      renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });
      expect(await screen.findByText('Chamado não encontrado')).toBeInTheDocument();
    });
  });
});
