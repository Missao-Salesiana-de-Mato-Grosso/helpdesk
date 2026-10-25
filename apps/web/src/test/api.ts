import { vi } from 'vitest';

export type Handler = (init: RequestInit | undefined, url: URL) => Response;

/**
 * Substitui o `fetch` por rotas `"MÉTODO /caminho"` (sem a query string, que o handler recebe em
 * `url`). Rota não mockada falha o teste.
 */
export function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`rota não mockada: ${key}`);
    return handler(init, url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Corpo JSON enviado numa chamada do `fetch`. */
export function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}
