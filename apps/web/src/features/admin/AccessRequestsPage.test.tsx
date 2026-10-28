import type { AccessRequestListResponse, MeResponse } from '@helpdesk/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonBody, stubApi } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { AccessRequestsPage } from './AccessRequestsPage.tsx';

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

const COMPANY = { id: 'c1', name: 'Sede' };
const DEPARTMENT = { id: 'd1', name: 'Secretaria' };

const pendingList: AccessRequestListResponse = {
  items: [
    {
      id: 'req-1',
      name: 'Pedro',
      email: 'pedro@exemplo.com',
      company: null,
      department: null,
      isExternalDomain: true,
      accessStatus: 'pending',
      accessRequestedAt: '2026-10-20T10:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(`^${label}`) }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('AccessRequestsPage (T22)', () => {
  it('lista a fila e aprova um pedido', async () => {
    let approveBody: unknown;
    const fetchMock = stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/users/access-requests': () => jsonResponse(200, pendingList),
      'GET /api/companies': () => jsonResponse(200, [COMPANY]),
      'GET /api/departments': () => jsonResponse(200, [DEPARTMENT]),
      'POST /api/users/req-1/access/approve': (init) => {
        approveBody = jsonBody(init);
        return jsonResponse(200, { ...ADMIN, id: 'req-1' });
      },
    });
    renderWithProviders(<AccessRequestsPage />);

    expect(await screen.findByText('Pedro')).toBeInTheDocument();
    expect(screen.getByText('Fora do domínio')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    const modal = await screen.findByRole('dialog');
    await choose('Unidade', COMPANY.name);
    await choose('Departamento', DEPARTMENT.name);
    await userEvent.click(within(modal).getByRole('button', { name: 'Aprovar' }));

    await waitFor(() =>
      expect(approveBody).toEqual({
        companyId: COMPANY.id,
        departmentId: DEPARTMENT.id,
        isExternal: false,
      }),
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').length).toBe(0);
  });

  it('mostra "nenhum pedido pendente" quando a fila está vazia', async () => {
    stubApi({
      'GET /api/me': () => jsonResponse(200, ADMIN),
      'GET /api/users/access-requests': () =>
        jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 25 }),
    });
    renderWithProviders(<AccessRequestsPage />);
    expect(await screen.findByText('Nenhum pedido pendente.')).toBeInTheDocument();
  });
});
