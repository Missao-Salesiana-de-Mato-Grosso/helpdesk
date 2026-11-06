import type { CategoryItem, MeResponse } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonBody, stubApi } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { CategoriesPage, CompaniesPage } from './CatalogPages.tsx';
import { GroupsPage } from './GroupsPage.tsx';

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

describe('CompaniesPage (T25)', () => {
  it('lista com a situação, cria uma unidade e renomeia/desativa outra', async () => {
    const bodies: { method: string; path: string; body: unknown }[] = [];
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/admin/companies': () =>
        jsonResponse(200, [
          { id: 'c1', name: 'Sede', active: true },
          { id: 'c2', name: 'Unidade de exemplo', active: true },
        ]),
      'POST /api/admin/companies': (init) => {
        bodies.push({ method: 'POST', path: 'companies', body: jsonBody(init) });
        return jsonResponse(201, { id: 'c3', name: 'Escola Nova', active: true });
      },
      'PATCH /api/admin/companies/c2': (init) => {
        bodies.push({ method: 'PATCH', path: 'companies/c2', body: jsonBody(init) });
        return jsonResponse(200, { id: 'c2', name: 'Escola Dom Bosco', active: false });
      },
    });
    renderWithProviders(<CompaniesPage />);

    const row = (await screen.findByText('Unidade de exemplo')).closest('tr')!;
    expect(within(row).getByText('Ativo')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nova unidade' }));
    const create = await screen.findByRole('dialog', { name: 'Nova unidade' });
    expect(within(create).queryByLabelText(/Ativo/)).not.toBeInTheDocument();
    await userEvent.type(within(create).getByLabelText('Nome'), ' Escola Nova ');
    await userEvent.click(within(create).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies).toContainEqual({
        method: 'POST',
        path: 'companies',
        body: { name: 'Escola Nova' },
      }),
    );

    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const edit = await screen.findByRole('dialog', { name: 'Editar Unidade de exemplo' });
    const name = within(edit).getByLabelText(/^Nome/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Escola Dom Bosco');
    await userEvent.click(within(edit).getByLabelText(/^Ativo/));
    await userEvent.click(within(edit).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies).toContainEqual({
        method: 'PATCH',
        path: 'companies/c2',
        body: { name: 'Escola Dom Bosco', active: false },
      }),
    );
  });
});

const category = (overrides: Partial<CategoryItem>): CategoryItem => ({
  id: 'k1',
  name: 'Rede',
  active: true,
  defaultGroup: { id: 'g1', name: 'Suporte TI', active: true },
  locked: false,
  ...overrides,
});

const categoryRoutes = (onPost?: (body: unknown) => void, onPatch?: (body: unknown) => void) => ({
  'GET /api/me': () => jsonResponse(200, ADMIN),
  'GET /api/admin/categories': () =>
    jsonResponse(200, [category({ id: 'k0', name: 'Geral', locked: true }), category({})]),
  'GET /api/admin/groups': () =>
    jsonResponse(200, [
      { id: 'g1', name: 'Suporte TI', email: null, active: true },
      { id: 'g2', name: 'Sistemas', email: null, active: true },
      { id: 'g9', name: 'Antigo', email: null, active: false },
    ]),
  'POST /api/admin/categories': (init: RequestInit | undefined) => {
    onPost?.(jsonBody(init));
    return jsonResponse(201, category({ id: 'k2', name: 'Impressoras' }));
  },
  'PATCH /api/admin/categories/k0': (init: RequestInit | undefined) => {
    onPatch?.(jsonBody(init));
    return jsonResponse(200, category({ id: 'k0', name: 'Geral', locked: true }));
  },
});

describe('CategoriesPage (T25)', () => {
  it('a "Geral" só troca de grupo padrão: nome e Ativo travados', async () => {
    let patchBody: unknown;
    stubApi(categoryRoutes(undefined, (body) => (patchBody = body)));
    renderWithProviders(<CategoriesPage />);

    const row = (await screen.findByText('Geral')).closest('tr')!;
    expect(within(row).getByText('Padrão do e-mail')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar Geral' });
    expect(within(dialog).getByLabelText('Nome')).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Ativo/)).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Grupo padrão/ }));
    expect(await screen.findByRole('option', { name: 'Antigo (inativo)' })).toHaveAttribute(
      'data-combobox-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('option', { name: 'Sistemas' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(patchBody).toEqual({ defaultGroupId: 'g2' }));
  });

  it('nova categoria exige o grupo padrão', async () => {
    let postBody: unknown;
    stubApi(categoryRoutes((body) => (postBody = body)));
    renderWithProviders(<CategoriesPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Nova categoria' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova categoria' });
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Impressoras');
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(save).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Grupo padrão/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Suporte TI' }));
    await userEvent.click(save);
    await waitFor(() => expect(postBody).toEqual({ name: 'Impressoras', defaultGroupId: 'g1' }));
  });
});

describe('GroupsPage (T25)', () => {
  it('mostra o erro da API ao desativar grupo padrão de categoria ativa', async () => {
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/admin/groups': () =>
        jsonResponse(200, [
          { id: 'g1', name: 'Suporte TI', email: 'suporte@missaosalesiana.org.br', active: true },
        ]),
      'PATCH /api/admin/groups/g1': () =>
        jsonResponse(422, {
          statusCode: 422,
          code: 'GROUP_IN_USE',
          message: 'O grupo é o padrão de categorias ativas (Geral).',
        }),
    });
    renderWithProviders(<GroupsPage />);

    expect(await screen.findByText('suporte@missaosalesiana.org.br')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar Suporte TI' });
    await userEvent.click(within(dialog).getByLabelText(/^Ativo/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(dialog).findByText('O grupo é o padrão de categorias ativas (Geral).'),
    ).toBeInTheDocument();
  });
});
