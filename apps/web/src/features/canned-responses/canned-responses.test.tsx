import type { CannedResponse, MeResponse } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useImperativeHandle } from 'react';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlEditorProps } from '../../components/HtmlEditor.tsx';
import { AppRoutes } from '../../routes.tsx';
import { jsonBody, stubApi, type Handler } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { CATEGORY, COMPANY, TICKET_ID, detail, me } from '../../test/tickets.ts';
import { CannedResponsesPage } from './CannedResponsesPage.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

// O ProseMirror não aceita digitação pelo jsdom; o editor real tem teste próprio (HtmlEditor.test).
// Aqui `insertHtml` acrescenta ao fim, o que basta para conferir o que foi inserido.
vi.mock('../../components/HtmlEditor.tsx', () => ({
  HtmlEditor: ({ label, value, onChange, handleRef }: HtmlEditorProps) => {
    useImperativeHandle(handleRef, () => ({ insertHtml: (html) => onChange(value + html) }), [
      value,
      onChange,
    ]);
    return (
      <label>
        {label}
        <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
    );
  },
}));

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue(fakeAuth());
});

const agent: MeResponse = {
  ...me,
  id: 'a1',
  name: 'João Agente',
  roles: ['agente'],
  isAgent: true,
  groups: [{ id: 'g1', name: 'Suporte TI' }],
};

const CANNED: CannedResponse[] = [
  {
    id: 'r1',
    title: 'Senha expirada',
    bodyHtml: '<p>Olá, {{solicitante}}! Sobre o chamado {{numero}}: troque a senha. {{agente}}</p>',
    updatedAt: '2026-11-06T12:00:00.000Z',
  },
  {
    id: 'r2',
    title: 'Wi-Fi',
    bodyHtml: '<p>Use a rede MSMT.</p>',
    updatedAt: '2026-11-06T12:00:00.000Z',
  },
];

const base: Record<string, Handler> = {
  'GET /api/me': () => jsonResponse(200, agent),
  'GET /api/tickets/counters': () =>
    jsonResponse(200, { mine: 0, group: 0, unassigned: 0, noCompany: 0 }),
  'GET /api/companies': () => jsonResponse(200, [COMPANY]),
  'GET /api/groups': () => jsonResponse(200, [{ id: 'g1', name: 'Suporte TI' }]),
  'GET /api/groups/g1/members': () => jsonResponse(200, [{ id: 'a1', name: 'João Agente' }]),
  'GET /api/categories': () => jsonResponse(200, [CATEGORY]),
  'GET /api/canned-responses': () => jsonResponse(200, CANNED),
  [`GET /api/tickets/${TICKET_ID}`]: () => jsonResponse(200, detail({ number: 1042 })),
};

const pick = async (title: string) => {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Inserir resposta pronta' }));
  await userEvent.click(await screen.findByRole('option', { name: title }));
};

describe('respostas prontas no atendimento (T26)', () => {
  it('insere a resposta com as variáveis trocadas e envia', async () => {
    let body: unknown;
    stubApi({
      ...base,
      [`POST /api/tickets/${TICKET_ID}/messages`]: (init) => {
        body = jsonBody(init);
        return jsonResponse(201, detail());
      },
    });
    renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });

    const editor = await screen.findByLabelText('Resposta ao solicitante');
    await userEvent.type(editor, '<p>Bom dia.</p>');
    await pick('Senha expirada');

    const expected =
      '<p>Bom dia.</p><p>Olá, Maria! Sobre o chamado #1042: troque a senha. João</p>';
    expect(editor).toHaveValue(expected);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(body).toEqual({ kind: 'public', bodyHtml: expected }));
  });

  it('também serve na nota interna, e a mesma resposta pode entrar de novo', async () => {
    stubApi(base);
    renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });

    await userEvent.click(await screen.findByRole('tab', { name: 'Nota interna' }));
    await pick('Wi-Fi');
    await pick('Wi-Fi');
    expect(screen.getByLabelText('Nota interna (só a equipe vê)')).toHaveValue(
      '<p>Use a rede MSMT.</p><p>Use a rede MSMT.</p>',
    );
    expect(screen.getByLabelText('Resposta ao solicitante', { selector: 'textarea' })).toHaveValue(
      '',
    );
  });
});

describe('CannedResponsesPage (T26)', () => {
  const supervisor: MeResponse = { ...agent, roles: ['supervisor'] };

  it('lista com o começo do texto, cria e exclui com confirmação', async () => {
    const calls: { method: string; body: unknown }[] = [];
    stubApi({
      'GET /api/me': () => jsonResponse(200, supervisor),
      'GET /api/canned-responses': () => jsonResponse(200, CANNED),
      'POST /api/canned-responses': (init) => {
        calls.push({ method: 'POST', body: jsonBody(init) });
        return jsonResponse(201, CANNED[1]);
      },
      'DELETE /api/canned-responses/r2': () => {
        calls.push({ method: 'DELETE', body: null });
        return new Response(null, { status: 204 });
      },
    });
    renderWithProviders(<CannedResponsesPage />);

    expect(await screen.findByText('Use a rede MSMT.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nova resposta' }));
    const create = await screen.findByRole('dialog', { name: 'Nova resposta pronta' });
    expect(within(create).getByText('{{solicitante}}')).toBeInTheDocument();
    await userEvent.type(within(create).getByLabelText(/^Título/), 'Impressora');
    await userEvent.type(within(create).getByLabelText('Texto'), '<p>Reinicie.</p>');
    await userEvent.click(within(create).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        body: { title: 'Impressora', bodyHtml: '<p>Reinicie.</p>' },
      }),
    );

    const row = screen.getByText('Wi-Fi').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const edit = await screen.findByRole('dialog', { name: 'Editar Wi-Fi' });
    await userEvent.click(within(edit).getByRole('button', { name: 'Excluir resposta' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await userEvent.click(within(edit).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', body: null }));
  });
});
