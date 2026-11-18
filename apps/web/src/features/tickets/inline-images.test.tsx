import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlEditorProps } from '../../components/HtmlEditor.tsx';
import { AppRoutes } from '../../routes.tsx';
import { callsTo, formBody, stubApi } from '../../test/api.ts';
import { fakeAuth, jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { TICKET_ID, detail, me, message } from '../../test/tickets.ts';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

// O ProseMirror não aceita digitação pelo jsdom: o editor falso insere a imagem pela store, como o
// real faz no botão, no colar e no arrastar. O editor real tem teste próprio (HtmlEditor.test).
vi.mock('../../components/HtmlEditor.tsx', () => ({
  HtmlEditor: ({ label, value, onChange, images }: HtmlEditorProps) => (
    <div>
      <label>
        {label}
        <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
      {images && (
        <>
          <button
            type="button"
            onClick={() => {
              const { key, url } = images.add(
                new File(['png'], 'print.png', { type: 'image/png' }),
              );
              onChange(`${value}<img src="${url}" data-inline-key="${key}">`);
            }}
          >
            Inserir imagem
          </button>
          <button
            type="button"
            onClick={() => onChange(value.replace(/<img[^>]*>/g, '') || '<p>sem imagem</p>')}
          >
            Apagar imagens
          </button>
        </>
      )}
    </div>
  ),
}));

describe('imagens no texto (spec T32)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(fakeAuth());
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:imagem'), revokeObjectURL: vi.fn() }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const inlineAttachment = {
    id: 'img1',
    filename: 'print.png',
    mimeType: 'image/png',
    sizeBytes: 3,
    inline: true,
  };
  const ticketWithImage = detail({
    messages: [
      message({
        bodyHtml: '<p>Veja:</p><img data-attachment-id="img1" alt="tela" />',
        attachments: [
          inlineAttachment,
          {
            id: 'doc1',
            filename: 'nota.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 9,
            inline: false,
          },
        ],
      }),
    ],
  });
  const routes = (ok: boolean) => ({
    'GET /api/me': () => jsonResponse(200, me),
    [`GET /api/tickets/${TICKET_ID}`]: () => jsonResponse(200, ticketWithImage),
    'GET /api/attachments/img1': () =>
      ok ? new Response('png', { status: 200 }) : jsonResponse(404, { code: 'NOT_FOUND' }),
  });

  it('CT-20 a imagem é baixada com o token e exibida; não entra na lista de anexos', async () => {
    const fetchMock = stubApi(routes(true));
    renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });

    const img = await screen.findByRole('img', { name: 'tela' });
    await waitFor(() => expect(img).toHaveAttribute('src', 'blob:imagem'));
    const [, init] = callsTo(fetchMock, 'GET /api/attachments/img1')[0]!;
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123');

    const list = screen.getByLabelText('Anexos');
    expect(within(list).getByRole('button', { name: /nota\.pdf/ })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /print\.png/ })).not.toBeInTheDocument();
  });

  it('CT-20 com falha no download fica o texto alternativo', async () => {
    stubApi(routes(false));
    renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });
    expect(await screen.findByText('[tela]')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'tela' })).not.toBeInTheDocument();
  });

  it('CT-21 enviar manda inline + inlineImages; imagem apagada do texto não vai', async () => {
    const bodies: ReturnType<typeof formBody>[] = [];
    const ticket = detail({ messages: [message()] });
    stubApi({
      'GET /api/me': () => jsonResponse(200, me),
      [`GET /api/tickets/${TICKET_ID}`]: () => jsonResponse(200, ticket),
      [`POST /api/tickets/${TICKET_ID}/messages`]: (init) => {
        bodies.push(formBody(init));
        return jsonResponse(201, ticket);
      },
    });
    renderWithProviders(<AppRoutes />, { route: `/tickets/${TICKET_ID}` });

    await userEvent.type(await screen.findByLabelText('Sua resposta'), 'Veja');
    await userEvent.click(screen.getByRole('button', { name: 'Inserir imagem' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    const sent = bodies[0]!;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON do campo data.
    const data = sent.data as { bodyHtml: string; inlineImages: string[] };
    expect(sent.inline).toEqual(['print.png']);
    expect(data.inlineImages).toHaveLength(1);
    expect(data.bodyHtml).toContain(`data-inline-key="${data.inlineImages[0]}"`);

    // Segunda resposta: a imagem foi inserida e apagada antes de enviar.
    await userEvent.type(screen.getByLabelText('Sua resposta'), 'Outra');
    await userEvent.click(screen.getByRole('button', { name: 'Inserir imagem' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apagar imagens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toBeUndefined(); // sem arquivos: JSON puro
  });
});
