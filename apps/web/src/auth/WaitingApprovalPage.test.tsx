import type { MeResponse } from '@helpdesk/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../routes.tsx';
import { stubApi } from '../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders, type FakeAuth } from '../test/render.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

const PENDING: MeResponse = {
  id: 'u1',
  name: 'Maria Silva',
  email: 'maria@missaosalesiana.org.br',
  roles: [],
  isAgent: false,
  company: { id: 'c1', name: 'Sede' },
  department: { id: 'd1', name: 'Secretaria' },
  groups: [],
  needsOnboarding: false,
  accessStatus: 'pending',
};

let auth: FakeAuth;

beforeEach(() => {
  auth = fakeAuth();
  mockedUseAuth.mockReturnValue(auth);
});

describe('WaitingApprovalPage (T22)', () => {
  it('mostra a unidade/departamento informados e o botão Sair', async () => {
    stubApi({ 'GET /api/me': () => jsonResponse(200, PENDING) });
    renderWithProviders(<AppRoutes />);
    expect(
      await screen.findByRole('heading', { name: 'Aguardando liberação' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Maria/)).toBeInTheDocument();
    expect(screen.getByText(/Sede/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(auth.signoutRedirect).toHaveBeenCalled();
  });

  it('já aprovado ao abrir /aguardando-liberacao diretamente → entra no portal sozinho', async () => {
    stubApi({
      'GET /api/me': () => jsonResponse(200, { ...PENDING, accessStatus: 'approved' }),
      'GET /api/tickets/counters': () =>
        jsonResponse(200, { mine: 0, group: 0, unassigned: 0, noCompany: 0 }),
    });
    renderWithProviders(<AppRoutes />, { route: '/aguardando-liberacao' });
    expect(await screen.findByRole('heading', { name: 'Meus tickets' })).toBeInTheDocument();
  });

  it('recusado entretanto → vai para a tela de acesso não liberado', async () => {
    stubApi({ 'GET /api/me': () => jsonResponse(200, { ...PENDING, accessStatus: 'rejected' }) });
    renderWithProviders(<AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Acesso não liberado' })).toBeInTheDocument();
  });
});
