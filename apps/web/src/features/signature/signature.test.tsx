import type { MeResponse } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlEditorProps } from '../../components/HtmlEditor.tsx';
import { AppRoutes } from '../../routes.tsx';
import { callsTo, jsonBody, stubApi, type Handler } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { me } from '../../test/tickets.ts';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

// O ProseMirror não aceita digitação pelo jsdom; o editor real tem teste próprio (HtmlEditor.test).
vi.mock('../../components/HtmlEditor.tsx', () => ({
  HtmlEditor: ({ label, value, onChange }: HtmlEditorProps) => (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  ),
}));

const agent: MeResponse = {
  ...me,
  id: 'a1',
  name: 'João Agente',
  roles: ['agente'],
  isAgent: true,
};

const base = (user: MeResponse): Record<string, Handler> => ({
  'GET /api/me': () => jsonResponse(200, user),
  'GET /api/tickets/counters': () =>
    jsonResponse(200, { mine: 0, group: 0, unassigned: 0, noCompany: 0, slaBreached: 0 }),
  'GET /api/tickets': () => jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 25 }),
  'GET /api/companies': () => jsonResponse(200, []),
  'GET /api/groups': () => jsonResponse(200, []),
});

describe('Minha assinatura (spec T31)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CT-19 abre com a assinatura salva, grava a nova e atualiza a prévia', async () => {
    let body: unknown;
    stubApi({
      ...base(agent),
      'GET /api/me/signature': () => jsonResponse(200, { signatureHtml: '<p>João — TI</p>' }),
      'PUT /api/me/signature': (init) => {
        body = jsonBody(init);
        return jsonResponse(200, { signatureHtml: '<p>João Agente — Suporte</p>' });
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/assinatura' });

    const editor = await screen.findByLabelText('Assinatura');
    expect(editor).toHaveValue('<p>João — TI</p>');
    const preview = screen.getByRole('region', { name: 'Prévia no e-mail' });
    expect(within(preview).getByText('João — TI')).toBeInTheDocument();

    await userEvent.clear(editor);
    await userEvent.type(editor, '<p>João Agente — Suporte</p>');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Assinatura salva.')).toBeInTheDocument();
    expect(body).toEqual({ signatureHtml: '<p>João Agente — Suporte</p>' });
    expect(within(preview).getByText('João Agente — Suporte')).toBeInTheDocument();
  });

  it('CT-19 salvar vazio remove a assinatura', async () => {
    let body: unknown;
    stubApi({
      ...base(agent),
      'GET /api/me/signature': () => jsonResponse(200, { signatureHtml: '<p>João — TI</p>' }),
      'PUT /api/me/signature': (init) => {
        body = jsonBody(init);
        return jsonResponse(200, { signatureHtml: null });
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/assinatura' });

    await userEvent.clear(await screen.findByLabelText('Assinatura'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Assinatura removida.')).toBeInTheDocument();
    expect(body).toEqual({ signatureHtml: '' });
    expect(screen.getByText(/Sem assinatura/)).toBeInTheDocument();
  });

  it('CT-20 o item "Minha assinatura" só aparece no menu do agente', async () => {
    stubApi({
      ...base(agent),
      'GET /api/me/signature': () => jsonResponse(200, { signatureHtml: null }),
    });
    renderWithProviders(<AppRoutes />, { route: '/' });

    await userEvent.click(await screen.findByRole('button', { name: 'Menu do usuário' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Minha assinatura' }));
    expect(await screen.findByRole('heading', { name: 'Minha assinatura' })).toBeInTheDocument();
  });

  it('CT-20 solicitante não vê o item e a rota responde "Sem permissão"', async () => {
    const fetchMock = stubApi(base(me));
    renderWithProviders(<AppRoutes />, { route: '/assinatura' });

    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Menu do usuário' }));
    expect(await screen.findByRole('menuitem', { name: 'Sair' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Minha assinatura' })).not.toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, 'GET /api/me/signature')).toHaveLength(0));
  });
});
