import type { MeResponse } from '@helpdesk/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../routes.tsx';
import { fakeAuth, jsonResponse, renderWithProviders } from '../test/render.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const COMPANY = { id: '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d', name: 'Colégio Dom Bosco' };
const DEPARTMENT = { id: '6a1e0c3b-2f4d-4b8a-8e2c-9d7f6e5a4b3c', name: 'Secretaria' };

const pending: MeResponse = {
  id: 'u1',
  name: 'Maria Silva',
  email: 'maria@missaosalesiana.org.br',
  roles: [],
  isAgent: false,
  company: null,
  department: null,
  groups: [],
  needsOnboarding: true,
};

type Handler = (init?: RequestInit) => Response;

function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`rota não mockada: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(`^${label}`) }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('Primeiro acesso (T16)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usuário sem unidade é levado ao 1º acesso, mesmo pedindo outra rota', async () => {
    stubApi({
      'GET /api/me': () => jsonResponse(200, pending),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/departments': () => jsonResponse(200, [DEPARTMENT]),
    });
    renderWithProviders(<AppRoutes />, { route: '/tickets/novo' });
    expect(await screen.findByRole('heading', { name: 'Primeiro acesso' })).toBeInTheDocument();
  });

  it('sem escolher → mostra os erros e não chama a API', async () => {
    const fetchMock = stubApi({
      'GET /api/me': () => jsonResponse(200, pending),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/departments': () => jsonResponse(200, [DEPARTMENT]),
    });
    renderWithProviders(<AppRoutes />, { route: '/primeiro-acesso' });
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Informe a unidade')).toBeInTheDocument();
    expect(screen.getByText('Informe o departamento')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('após preencher, envia PATCH /api/me e acessa o portal', async () => {
    let body: unknown;
    stubApi({
      'GET /api/me': () => jsonResponse(200, pending),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/departments': () => jsonResponse(200, [DEPARTMENT]),
      'PATCH /api/me': (init) => {
        body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        return jsonResponse(200, {
          ...pending,
          company: COMPANY,
          department: DEPARTMENT,
          needsOnboarding: false,
        });
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/primeiro-acesso' });
    await screen.findByRole('heading', { name: 'Primeiro acesso' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Unidade/ })).toBeEnabled());
    await choose('Unidade', COMPANY.name);
    await choose('Departamento', DEPARTMENT.name);
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('heading', { name: 'Meus tickets' })).toBeInTheDocument();
    expect(body).toEqual({ companyId: COMPANY.id, departmentId: DEPARTMENT.id });
  });

  it('erro 422 da API aparece no formulário', async () => {
    stubApi({
      'GET /api/me': () => jsonResponse(200, pending),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/departments': () => jsonResponse(200, [DEPARTMENT]),
      'PATCH /api/me': () =>
        jsonResponse(422, {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: 'Departamento inexistente ou inativo.',
        }),
    });
    renderWithProviders(<AppRoutes />, { route: '/primeiro-acesso' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Unidade/ })).toBeEnabled());
    await choose('Unidade', COMPANY.name);
    await choose('Departamento', DEPARTMENT.name);
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Departamento inexistente ou inativo.')).toBeInTheDocument();
  });

  it('quem já fez o 1º acesso e abre /primeiro-acesso volta ao início', async () => {
    stubApi({
      'GET /api/me': () =>
        jsonResponse(200, {
          ...pending,
          company: COMPANY,
          department: DEPARTMENT,
          needsOnboarding: false,
        }),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/departments': () => jsonResponse(200, [DEPARTMENT]),
    });
    renderWithProviders(<AppRoutes />, { route: '/primeiro-acesso' });
    expect(await screen.findByRole('heading', { name: 'Meus tickets' })).toBeInTheDocument();
  });
});
