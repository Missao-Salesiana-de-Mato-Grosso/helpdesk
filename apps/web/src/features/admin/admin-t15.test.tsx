import type { MeResponse, UserListResponse, UserSummary } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonBody, stubApi } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { GroupsPage } from './GroupsPage.tsx';
import { UsersPage } from './UsersPage.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue(fakeAuth());
});

const ADMIN: MeResponse = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@missaosalesiana.org.br',
  roles: ['admin'],
  isAgent: true,
  company: { id: 'c1', name: 'Sede' },
  department: { id: 'd1', name: 'Secretaria' },
  groups: [],
  needsOnboarding: false,
  accessStatus: 'approved',
};

const user = (overrides: Partial<UserSummary>): UserSummary => ({
  id: 'u1',
  name: 'Maria',
  email: 'maria@missaosalesiana.org.br',
  roles: [],
  company: { id: 'c1', name: 'Sede' },
  department: { id: 'd1', name: 'Secretaria' },
  groups: [],
  isExternal: false,
  active: true,
  accessStatus: 'approved',
  lastLoginAt: null,
  ...overrides,
});

const list = (items: UserSummary[]): UserListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});

describe('UsersPage (T15)', () => {
  it('lista, busca e inativa um usuário', async () => {
    const queries: string[] = [];
    let patchBody: unknown;
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/users': (_init, url) => {
        queries.push(url.searchParams.get('q') ?? '');
        return jsonResponse(
          200,
          list([
            user({
              id: 'u1',
              name: 'Maria',
              roles: ['agente'],
              groups: [{ id: 'g1', name: 'TI' }],
            }),
          ]),
        );
      },
      'GET /api/companies': () => jsonResponse(200, [{ id: 'c1', name: 'Sede' }]),
      'GET /api/departments': () => jsonResponse(200, [{ id: 'd1', name: 'Secretaria' }]),
      'PATCH /api/users/u1': (init) => {
        patchBody = jsonBody(init);
        return jsonResponse(200, user({ active: false }));
      },
    });
    renderWithProviders(<UsersPage />);

    expect(await screen.findByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Agente')).toBeInTheDocument();
    expect(screen.getByText('TI')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar' }), 'mar');
    await waitFor(() => expect(queries).toContain('mar'));

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const modal = await screen.findByRole('dialog');
    await userEvent.click(within(modal).getByRole('checkbox', { name: /Ativo/ }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(patchBody).toEqual({
        companyId: 'c1',
        departmentId: 'd1',
        isExternal: false,
        active: false,
      }),
    );
  });

  it('não deixa o admin se inativar', async () => {
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/users': () => jsonResponse(200, list([user({ id: 'admin-1', name: 'Admin' })])),
      'GET /api/companies': () => jsonResponse(200, []),
      'GET /api/departments': () => jsonResponse(200, []),
    });
    renderWithProviders(<UsersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const modal = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(modal).getByRole('checkbox', { name: /Ativo/ })).toBeDisabled(),
    );
    expect(within(modal).getByText('Você não pode inativar a própria conta.')).toBeInTheDocument();
  });
});

describe('GroupsPage (T15)', () => {
  it('troca os membros de um grupo', async () => {
    let putBody: unknown;
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/groups': () => jsonResponse(200, [{ id: 'g1', name: 'Suporte TI' }]),
      'GET /api/groups/g1/members': () => jsonResponse(200, [{ id: 'a1', name: 'Ana' }]),
      'GET /api/users': (_init, url) => {
        expect(url.searchParams.get('role')).toBe('agent');
        return jsonResponse(
          200,
          list([
            user({ id: 'a1', name: 'Ana', email: 'ana@x.org', roles: ['agente'] }),
            user({ id: 'b1', name: 'Bruno', email: 'bruno@x.org', roles: ['agente'] }),
            user({ id: 'z1', name: 'Zeca', email: 'zeca@x.org', roles: ['agente'], active: false }),
          ]),
        );
      },
      'PUT /api/groups/g1/members': (init) => {
        putBody = jsonBody(init);
        return jsonResponse(200, [
          { id: 'a1', name: 'Ana' },
          { id: 'b1', name: 'Bruno' },
        ]);
      },
    });
    renderWithProviders(<GroupsPage />);

    await userEvent.click(await screen.findByRole('combobox', { name: 'Grupo' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Suporte TI' }));

    const save = await screen.findByRole('button', { name: 'Salvar membros' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('combobox', { name: /^Membros/ }));
    expect(screen.queryByRole('option', { name: /Zeca/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: /Bruno/ }));
    await userEvent.click(save);

    await waitFor(() => expect(putBody).toEqual({ userIds: ['a1', 'b1'] }));
    expect(await screen.findByText('Membros salvos.')).toBeInTheDocument();
  });
});
