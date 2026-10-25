import type { MeResponse, Role } from '@helpdesk/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../routes.tsx';
import { callsTo, stubApi } from '../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders, type FakeAuth } from '../test/render.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const AGENT_ROLES = new Set<Role>(['agente', 'supervisor', 'admin']);

function me(roles: Role[]): MeResponse {
  return {
    id: 'u1',
    name: 'Maria Silva',
    email: 'maria@missaosalesiana.org.br',
    roles,
    isAgent: roles.some((role) => AGENT_ROLES.has(role)),
    company: { id: 'c1', name: 'Sede' },
    department: { id: 'd1', name: 'Secretaria' },
    groups: [],
    needsOnboarding: false,
  };
}

let auth: FakeAuth;

const COUNTERS = { mine: 3, group: 12, unassigned: 4, noCompany: 1 };

function renderAs(roles: Role[], route = '/') {
  const fetchMock = stubApi({
    'GET /api/me': () => jsonResponse(200, me(roles)),
    'GET /api/tickets/counters': () => jsonResponse(200, COUNTERS),
    'GET /api/tickets': () => jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 25 }),
    'GET /api/companies': () => jsonResponse(200, []),
    'GET /api/groups': () => jsonResponse(200, []),
  });
  renderWithProviders(<AppRoutes />, { route });
  return fetchMock;
}

const menu = () => screen.getByRole('navigation', { name: 'Menu principal' });

describe('AppLayout e rotas (T07)', () => {
  beforeEach(() => {
    auth = fakeAuth();
    vi.mocked(useAuth).mockReturnValue(auth);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('solicitante: início em "Meus tickets", sem menu de atendimento nem de administração', async () => {
    renderAs([]);
    expect(await screen.findByRole('heading', { name: 'Meus tickets' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Novo ticket' })).toBeInTheDocument();
    expect(within(menu()).queryByText('Atendimento')).not.toBeInTheDocument();
    expect(within(menu()).queryByText('Administração')).not.toBeInTheDocument();
  });

  it('agente: início na própria fila, menu de atendimento sem administração', async () => {
    renderAs(['agente']);
    expect(await screen.findByRole('heading', { name: 'Fila — Meus' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: /^Sem atribuição/ })).toBeInTheDocument();
    expect(within(menu()).queryByText('Administração')).not.toBeInTheDocument();
  });

  it('agente: contadores das filas no menu (GET /tickets/counters)', async () => {
    renderAs(['agente']);
    await screen.findByRole('heading', { name: 'Fila — Meus' });
    expect(await within(menu()).findByRole('link', { name: 'Meus 3' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Do meu grupo 12' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Sem atribuição 4' })).toBeInTheDocument();
    expect(within(menu()).getByRole('link', { name: 'Todos' })).toBeInTheDocument();
  });

  it('solicitante não consulta os contadores', async () => {
    const fetchMock = renderAs([]);
    await screen.findByRole('heading', { name: 'Meus tickets' });
    expect(callsTo(fetchMock, 'GET /api/tickets/counters')).toHaveLength(0);
  });

  it('admin: vê administração e navega pelo menu', async () => {
    renderAs(['admin']);
    await screen.findByRole('heading', { name: 'Fila — Meus' });
    await userEvent.click(within(menu()).getByRole('link', { name: 'Usuários' }));
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
    await userEvent.click(within(menu()).getByRole('link', { name: /^Do meu grupo/ }));
    expect(await screen.findByRole('heading', { name: 'Fila — Do meu grupo' })).toBeInTheDocument();
  });

  it('solicitante que digita a URL da fila ou do admin vê "Sem permissão"', async () => {
    renderAs([], '/fila/meus');
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeInTheDocument();
  });

  it('agente sem role admin em /admin/usuarios vê "Sem permissão"', async () => {
    renderAs(['agente'], '/admin/usuarios');
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeInTheDocument();
  });

  it('fila inexistente cai em /fila/meus', async () => {
    renderAs(['agente'], '/fila/xyz');
    expect(await screen.findByRole('heading', { name: 'Fila — Meus' })).toBeInTheDocument();
  });

  it('cabeçalho mostra o usuário e o logout chama signoutRedirect', async () => {
    renderAs(['supervisor']);
    await userEvent.click(await screen.findByRole('button', { name: 'Menu do usuário' }));
    expect(await screen.findByText('maria@missaosalesiana.org.br')).toBeInTheDocument();
    expect(screen.getByText('Supervisor')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sair' }));
    expect(auth.signoutRedirect).toHaveBeenCalled();
  });

  it('rota desconhecida dentro do portal → "Página não encontrada"', async () => {
    renderAs([], '/nao-existe');
    expect(
      await screen.findByRole('heading', { name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });
});
