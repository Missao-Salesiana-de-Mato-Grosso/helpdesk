import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { AuthContextProps } from 'react-oidc-context';
import { MemoryRouter } from 'react-router';
import { vi, type Mock } from 'vitest';
import { ApiProvider } from '../api/ApiProvider.tsx';
import { theme } from '../theme.ts';

export type FakeAuth = AuthContextProps & { signinRedirect: Mock; signoutRedirect: Mock };

/** Estado mínimo do `useAuth()` (react-oidc-context) para os testes. */
export function fakeAuth(overrides: Record<string, unknown> = {}): FakeAuth {
  const auth = {
    isLoading: false,
    isAuthenticated: true,
    activeNavigator: undefined,
    error: undefined,
    user: { access_token: 'token-123' },
    signinRedirect: vi.fn().mockResolvedValue(undefined),
    signoutRedirect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  // Dublê parcial: os componentes só usam os campos acima.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return auth as unknown as FakeAuth;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Renderiza com Mantine, Router em memória, React Query sem retry e o cliente da API. */
export function renderWithProviders(ui: ReactElement, { route = '/' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // env="test" desliga transições e portais do Mantine, que o jsdom não anima.
  return render(
    <MantineProvider theme={theme} env="test">
      <MemoryRouter initialEntries={[route]}>
        <QueryClientProvider client={queryClient}>
          <ApiProvider>{ui}</ApiProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}
