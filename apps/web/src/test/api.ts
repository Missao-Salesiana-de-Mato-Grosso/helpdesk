import { vi } from 'vitest';

export type Handler = (init: RequestInit | undefined, url: URL) => Response;

/**
 * Substitui o `fetch` por rotas `"MÉTODO /caminho"` (sem a query string, que o handler recebe em
 * `url`). Rota não mockada falha o teste.
 */
export function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`rota não mockada: ${key}`);
    return handler(init, url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export type FetchMock = ReturnType<typeof stubApi>;

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://localhost');
}

/** Chamadas feitas a `"MÉTODO /caminho"` (sem a query string). */
export function callsTo(fetchMock: FetchMock, route: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => `${init?.method ?? 'GET'} ${requestUrl(input).pathname}` === route,
  );
}

/** Corpo JSON enviado numa chamada do `fetch`. */
export function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

/** Corpo multipart enviado (`data` como JSON e os nomes dos `files`). */
export function formBody(
  init: RequestInit | undefined,
): { data: unknown; files: string[] } | undefined {
  if (!(init?.body instanceof FormData)) return undefined;
  const raw = init.body.get('data');
  return {
    data: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    files: init.body.getAll('files').map((file) => (file instanceof File ? file.name : '')),
  };
}
