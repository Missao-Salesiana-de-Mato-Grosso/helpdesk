import type { MeResponse } from '@helpdesk/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuth, jsonResponse, renderWithProviders } from '../test/render.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { RequireRole } from './RequireRole.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

const ME: MeResponse = {
  id: 'u1',
  name: 'Maria Silva',
  email: 'maria@missaosalesiana.org.br',
  roles: [],
  isAgent: false,
  company: { id: 'c1', name: 'Sede' },
  department: { id: 'd1', name: 'Secretaria' },
  groups: [],
  needsOnboarding: false,
  accessStatus: 'approved',
};

const fetchMock = vi.fn<typeof fetch>();

function renderApp(route = '/') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <p>conteúdo protegido</p>
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireRole roles={['admin']}>
              <p>área do admin</p>
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/primeiro-acesso"
        element={
          <RequireAuth>
            <p>tela de primeiro acesso</p>
          </RequireAuth>
        }
      />
      <Route
        path="/aguardando-liberacao"
        element={
          <RequireAuth>
            <p>tela de espera</p>
          </RequireAuth>
        }
      />
      <Route
        path="/acesso-nao-liberado"
        element={
          <RequireAuth>
            <p>tela de acesso recusado</p>
          </RequireAuth>
        }
      />
    </Routes>,
    { route },
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sem sessão → signinRedirect com a rota atual em state.returnTo', async () => {
    const auth = fakeAuth({ isAuthenticated: false, user: undefined });
    mockedUseAuth.mockReturnValue(auth);
    renderApp('/admin?x=1');
    await waitFor(() =>
      expect(auth.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/admin?x=1' } }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('com sessão → chama /api/me com Bearer e mostra o conteúdo', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () => jsonResponse(200, ME));
    renderApp();
    expect(await screen.findByText('conteúdo protegido')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/me');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');
  });

  it('needsOnboarding → vai para /primeiro-acesso', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...ME, company: null, needsOnboarding: true }),
    );
    renderApp();
    expect(await screen.findByText('tela de primeiro acesso')).toBeInTheDocument();
  });

  // T22
  it('accessStatus pending → vai para /aguardando-liberacao', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () => jsonResponse(200, { ...ME, accessStatus: 'pending' }));
    renderApp();
    expect(await screen.findByText('tela de espera')).toBeInTheDocument();
  });

  it('accessStatus rejected → vai para /acesso-nao-liberado', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...ME, accessStatus: 'rejected' }),
    );
    renderApp();
    expect(await screen.findByText('tela de acesso recusado')).toBeInTheDocument();
  });

  it('needsOnboarding tem prioridade sobre accessStatus pending (RN-05)', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...ME, company: null, needsOnboarding: true, accessStatus: 'pending' }),
    );
    renderApp();
    expect(await screen.findByText('tela de primeiro acesso')).toBeInTheDocument();
  });

  it.each([
    'USER_INACTIVE',
    'EXTERNAL_USER_CANNOT_LOGIN',
    'WRONG_ORGANIZATION',
    'EMAIL_NOT_VERIFIED',
  ])('403 %s → tela "Sem acesso" com a mensagem e botão Sair', async (code) => {
    const auth = fakeAuth();
    mockedUseAuth.mockReturnValue(auth);
    fetchMock.mockResolvedValue(
      jsonResponse(403, { statusCode: 403, code, message: 'Mensagem da API.' }),
    );
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Sem acesso' })).toBeInTheDocument();
    expect(screen.getByText('Mensagem da API.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(auth.signoutRedirect).toHaveBeenCalled();
  });

  it(
    '503 AUTH_UNAVAILABLE → aviso e "Tentar de novo" refaz o /me',
    { timeout: 10_000 },
    async () => {
      mockedUseAuth.mockReturnValue(fakeAuth());
      fetchMock
        .mockImplementationOnce(async () =>
          jsonResponse(503, {
            statusCode: 503,
            code: 'AUTH_UNAVAILABLE',
            message: 'Indisponível.',
          }),
        )
        .mockImplementationOnce(async () =>
          jsonResponse(503, {
            statusCode: 503,
            code: 'AUTH_UNAVAILABLE',
            message: 'Indisponível.',
          }),
        )
        .mockImplementationOnce(async () =>
          jsonResponse(503, {
            statusCode: 503,
            code: 'AUTH_UNAVAILABLE',
            message: 'Indisponível.',
          }),
        )
        .mockImplementation(async () => jsonResponse(200, ME));
      renderApp();
      // useMe repete 5xx duas vezes (backoff de 1 s e 2 s) antes de mostrar o erro.
      expect(
        await screen.findByRole(
          'heading',
          { name: 'Autenticação temporariamente indisponível' },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
      expect(await screen.findByText('conteúdo protegido')).toBeInTheDocument();
    },
  );

  it('401 da API → novo login; segundo 401 em seguida → erro em vez de loop', async () => {
    const auth = fakeAuth();
    mockedUseAuth.mockReturnValue(auth);
    const unauthorized = { statusCode: 401, code: 'AUTH_INVALID', message: 'Token inválido.' };
    fetchMock.mockImplementation(async () => jsonResponse(401, unauthorized));

    const first = renderApp();
    await waitFor(() => expect(auth.signinRedirect).toHaveBeenCalledTimes(1));
    first.unmount();

    renderApp();
    expect(
      await screen.findByRole('heading', { name: 'Não foi possível entrar' }),
    ).toBeInTheDocument();
    expect(auth.signinRedirect).toHaveBeenCalledTimes(1);
  });
});

describe('RequireRole', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sem a role → "Sem permissão"', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...ME, roles: ['agente'], isAgent: true }),
    );
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeInTheDocument();
  });

  it('com a role → conteúdo', async () => {
    mockedUseAuth.mockReturnValue(fakeAuth());
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { ...ME, roles: ['admin'], isAgent: true }),
    );
    renderApp('/admin');
    expect(await screen.findByText('área do admin')).toBeInTheDocument();
  });
});
