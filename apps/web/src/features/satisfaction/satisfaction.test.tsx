// Spec docs/specs/T40-csat.md — página pública de avaliação e bloco no painel do chamado.
import {
  isSatisfactionScore,
  satisfactionRateSchema,
  type SatisfactionSurvey,
  type TicketSatisfaction,
} from '@helpdesk/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../routes.tsx';
import { callsTo, jsonBody, stubApi, type FetchMock } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { detail, me } from '../../test/tickets.ts';
import { TicketSidePanel } from '../agent/TicketSidePanel.tsx';
import { SatisfactionPanel } from './SatisfactionPanel.tsx';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE';

const survey = (overrides: Partial<SatisfactionSurvey> = {}): SatisfactionSurvey => ({
  ticketNumber: 1042,
  ticketSubject: 'Impressora da secretaria',
  score: null,
  comment: null,
  ratedAt: null,
  expiresAt: '2026-12-20T18:00:00.000Z',
  ...overrides,
});

const linkInvalid = () =>
  jsonResponse(404, {
    statusCode: 404,
    code: 'SURVEY_LINK_INVALID',
    message: 'Este link de avaliação expirou ou foi substituído por um mais novo.',
  });

const open = (route: string, current = survey()): FetchMock => {
  let saved = current;
  const fetchMock = stubApi({
    'POST /api/satisfaction/lookup': () => jsonResponse(200, saved),
    'PUT /api/satisfaction': (init) => {
      const body = satisfactionRateSchema.parse(jsonBody(init));
      saved = {
        ...saved,
        score: isSatisfactionScore(body.score) ? body.score : null,
        comment: body.comment,
        ratedAt: '2026-11-21T13:05:00.000Z',
      };
      return jsonResponse(200, saved);
    },
  });
  renderWithProviders(<AppRoutes />, { route });
  return fetchMock;
};

describe('página pública de avaliação (T40)', () => {
  beforeEach(() => {
    // Sem login: a página não depende do usuário.
    vi.mocked(useAuth).mockReturnValue(fakeAuth({ isAuthenticated: false, user: undefined }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CT-19 a nota do link vem marcada, mas só é gravada no "Enviar avaliação"', async () => {
    const fetchMock = open(`/avaliar?nota=4#${TOKEN}`);
    expect(await screen.findByText('Chamado #1042 — Impressora da secretaria')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '4 — Satisfeito' })).toBeChecked();
    expect(screen.getByText('Falta só confirmar: clique em Enviar avaliação.')).toBeInTheDocument();
    // O token foi no corpo, nunca na URL.
    const [lookup] = callsTo(fetchMock, 'POST /api/satisfaction/lookup');
    expect(jsonBody(lookup?.[1])).toEqual({ token: TOKEN });
    expect(lookup?.[0]).toBe('/api/satisfaction/lookup');
    expect(callsTo(fetchMock, 'PUT /api/satisfaction')).toHaveLength(0);

    await userEvent.type(
      screen.getByRole('textbox', { name: /Quer contar mais/ }),
      '  Resolveram rápido.  ',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));

    expect(await screen.findByText('Obrigado! Sua avaliação foi registrada.')).toBeInTheDocument();
    const [put] = callsTo(fetchMock, 'PUT /api/satisfaction');
    expect(jsonBody(put?.[1])).toEqual({ token: TOKEN, score: 4, comment: 'Resolveram rápido.' });
    expect(screen.getByText('Sua nota: 4 — Satisfeito')).toBeInTheDocument();
  });

  it('CT-19 avaliação já dada aparece e pode ser alterada', async () => {
    const fetchMock = open(
      `/avaliar#${TOKEN}`,
      survey({ score: 5, comment: 'Ótimo', ratedAt: '2026-11-20T13:00:00.000Z' }),
    );
    expect(await screen.findByText('Obrigado! Sua avaliação foi registrada.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }));
    expect(screen.getByRole('radio', { name: '5 — Muito satisfeito' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: /Quer contar mais/ })).toHaveValue('Ótimo');

    await userEvent.click(screen.getByRole('radio', { name: '2 — Insatisfeito' }));
    await userEvent.clear(screen.getByRole('textbox', { name: /Quer contar mais/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));

    expect(await screen.findByText('Sua nota: 2 — Insatisfeito')).toBeInTheDocument();
    const [put] = callsTo(fetchMock, 'PUT /api/satisfaction');
    expect(jsonBody(put?.[1])).toEqual({ token: TOKEN, score: 2, comment: null });
  });

  it('CT-19 sem nota no link (ou nota estranha), nada vem marcado e o envio fica desligado', async () => {
    open(`/avaliar?nota=7#${TOKEN}`);
    expect(await screen.findByRole('button', { name: 'Enviar avaliação' })).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.queryByText(/Falta só confirmar/)).not.toBeInTheDocument();
  });

  it('CT-20 sem token no fragmento, mostra o aviso sem chamar a API', async () => {
    const fetchMock = stubApi({});
    renderWithProviders(<AppRoutes />, { route: '/avaliar?nota=3' });
    expect(await screen.findByText('Link de avaliação inválido')).toBeInTheDocument();
    expect(screen.getByText(/expirou ou foi substituído por um mais novo/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CT-20 link expirado ou substituído (404) mostra o aviso', async () => {
    stubApi({ 'POST /api/satisfaction/lookup': linkInvalid });
    renderWithProviders(<AppRoutes />, { route: `/avaliar#${TOKEN}` });
    expect(await screen.findByText('Link de avaliação inválido')).toBeInTheDocument();
  });
});

const panel = (satisfaction: TicketSatisfaction | null) =>
  renderWithProviders(<SatisfactionPanel satisfaction={satisfaction} />);

describe('avaliação no painel do chamado (T40)', () => {
  const rated: TicketSatisfaction = {
    score: 4,
    comment: 'Resolveram rápido.',
    ratedAt: '2026-11-21T13:05:00.000Z',
    requestedAt: '2026-11-20T18:00:00.000Z',
    linkActive: true,
  };

  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CT-21 nota com rótulo e comentário; aguardando enquanto o link vale; sem avaliação', () => {
    let view = panel(rated);
    expect(screen.getByText('4 — Satisfeito')).toBeInTheDocument();
    expect(screen.getByText('Resolveram rápido.')).toBeInTheDocument();
    expect(screen.getByText('Avaliado em 21/11/2026, 09:05')).toBeInTheDocument();
    view.unmount();

    const waiting = { ...rated, score: null, comment: null, ratedAt: null };
    view = panel(waiting);
    expect(screen.getByText('Aguardando avaliação (link enviado em 20/11)')).toBeInTheDocument();
    view.unmount();

    view = panel({ ...waiting, linkActive: false });
    expect(screen.getByText('Sem avaliação')).toBeInTheDocument();
    view.unmount();

    panel(null);
    expect(screen.getByText('Sem avaliação')).toBeInTheDocument();
  });

  it('CT-21 o painel lateral só mostra o bloco quando a API manda `satisfaction`', async () => {
    stubApi({
      'GET /api/groups': () => jsonResponse(200, []),
      'GET /api/categories': () => jsonResponse(200, []),
      'GET /api/companies': () => jsonResponse(200, []),
      [`GET /api/groups/${detail().group.id}/members`]: () => jsonResponse(200, []),
    });
    const props = {
      me: { ...me, isAgent: true },
      onChange: vi.fn(),
      onCompanyRequired: vi.fn(),
      companyRef: null,
      companyError: undefined,
      saving: false,
    };
    const view = renderWithProviders(
      <TicketSidePanel {...props} ticket={detail({ satisfaction: rated })} />,
    );
    expect(await screen.findByText('Avaliação do solicitante')).toBeInTheDocument();
    view.unmount();

    // Agente: a API não manda o campo.
    renderWithProviders(<TicketSidePanel {...props} ticket={detail()} />);
    expect(await screen.findByText('Situação')).toBeInTheDocument();
    expect(screen.queryByText('Avaliação do solicitante')).not.toBeInTheDocument();
  });
});
