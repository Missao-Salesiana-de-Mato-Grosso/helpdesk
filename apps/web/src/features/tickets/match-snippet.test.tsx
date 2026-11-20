// Spec docs/specs/T38-busca-full-text.md — trecho da busca no texto.
import type { TicketListResponse } from '@helpdesk/shared';
import { screen } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../routes.tsx';
import { stubApi } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { me, summary } from '../../test/tickets.ts';
import { MatchSnippet } from './MatchSnippet.tsx';
import { splitSnippet } from './match-snippet.ts';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const S = '\uE000';
const E = '\uE001';

describe('splitSnippet (T38)', () => {
  it('CT-13 alterna texto e destaque; sem marcador, uma parte só', () => {
    expect(splitSnippet(`A ${S}impressora${E} da ${S}secretaria${E}.`)).toEqual([
      { text: 'A ', hit: false },
      { text: 'impressora', hit: true },
      { text: ' da ', hit: false },
      { text: 'secretaria', hit: true },
      { text: '.', hit: false },
    ]);
    expect(splitSnippet('Anexo: boleto.pdf')).toEqual([{ text: 'Anexo: boleto.pdf', hit: false }]);
  });
});

describe('MatchSnippet (T38)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  it('CT-14 destaca em <mark>, marca nota interna e nunca interpreta HTML', () => {
    renderWithProviders(
      <MatchSnippet
        match={{
          snippet: `senha do ${S}roteador${E} <script>alert(1)</script>`,
          source: 'internal',
        }}
      />,
    );
    const snippet = screen.getByTestId('match-snippet');
    expect(snippet.querySelector('mark')).toHaveTextContent('roteador');
    expect(snippet.querySelector('script')).toBeNull();
    expect(snippet).toHaveTextContent('<script>alert(1)</script>');
    expect(screen.getByText('Nota interna')).toBeInTheDocument();
  });

  it('CT-15 "Meus tickets" mostra o trecho abaixo do assunto', async () => {
    const list: TicketListResponse = {
      items: [
        summary({ match: { snippet: `a ${S}impressão${E} saiu borrada`, source: 'public' } }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    };
    stubApi({
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/tickets': () => jsonResponse(200, list),
    });
    renderWithProviders(<AppRoutes />, { route: '/tickets' });
    const link = await screen.findByRole('link', { name: 'Impressora da secretaria' });
    const cell = link.closest('td')!;
    expect(cell.querySelector('mark')).toHaveTextContent('impressão');
    expect(cell).toHaveTextContent('a impressão saiu borrada');
    expect(screen.queryByText('Nota interna')).not.toBeInTheDocument();
  });
});
