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

const REJECTED: MeResponse = {
  id: 'u1',
  name: 'Maria Silva',
  email: 'maria@missaosalesiana.org.br',
  roles: [],
  isAgent: false,
  company: { id: 'c1', name: 'Sede' },
  department: { id: 'd1', name: 'Secretaria' },
  groups: [],
  needsOnboarding: false,
  accessStatus: 'rejected',
};

let auth: FakeAuth;

beforeEach(() => {
  auth = fakeAuth();
  mockedUseAuth.mockReturnValue(auth);
});

describe('AccessRejectedPage (T22)', () => {
  it('mostra o texto fixo (sem o motivo interno) e o botão Sair', async () => {
    stubApi({ 'GET /api/me': () => jsonResponse(200, REJECTED) });
    renderWithProviders(<AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Acesso não liberado' })).toBeInTheDocument();
    expect(screen.getByText('suporte@missaosalesiana.org.br')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(auth.signoutRedirect).toHaveBeenCalled();
  });
});
