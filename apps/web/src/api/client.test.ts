import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/render.tsx';
import { ApiRequestError, createApiClient } from './client.ts';

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixa /api, envia Bearer e JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient(() => 'tok');
    await expect(api('/me', { method: 'PATCH', body: '{}' })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe('/api/me');
    expect(headers.get('Authorization')).toBe('Bearer tok');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('FormData vai sem Content-Type (o navegador define o boundary)', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);
    await createApiClient(() => 'tok')('/tickets', { method: 'POST', body: new FormData() });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('responseType blob devolve o Blob; erro continua virando ApiRequestError', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('%PDF', { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Anexo não encontrado.' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient(() => 'tok');
    const blob = await api<Blob>('/attachments/a1', { responseType: 'blob' });
    expect(blob.size).toBe(4);
    await expect(api('/attachments/a2', { responseType: 'blob' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('sem token não envia Authorization', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await createApiClient(() => undefined)('/health');
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has('Authorization')).toBe(false);
  });

  it('converte o corpo de erro em ApiRequestError com o code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(403, { statusCode: 403, code: 'FORBIDDEN_ROLE', message: 'Sem permissão.' }),
        ),
    );
    const error = await createApiClient(() => 'tok')('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN_ROLE',
      message: 'Sem permissão.',
    });
  });

  it('resposta não-JSON (ex.: 502 do proxy) vira INTERNAL_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 502 })),
    );
    await expect(createApiClient(() => 'tok')('/x')).rejects.toMatchObject({
      statusCode: 502,
      code: 'INTERNAL_ERROR',
    });
  });

  it('falha de rede vira status 0', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')));
    await expect(createApiClient(() => 'tok')('/x')).rejects.toMatchObject({ statusCode: 0 });
  });
});
