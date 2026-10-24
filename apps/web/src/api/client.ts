import { ApiErrorCode, type ApiError } from '@helpdesk/shared';

/** Erro de uma chamada à API, com o `code` do contrato (`ApiErrorCode`). */
export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * Cliente da API: prefixa `/api`, envia o Bearer do usuário logado e converte erros em
 * `ApiRequestError`. Falha de rede vira status 0; resposta sem o formato `ApiError`, `INTERNAL_ERROR`.
 */
export function createApiClient(getAccessToken: () => string | undefined): ApiFetch {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetch(`/api${path}`, { ...init, headers });
    } catch {
      throw new ApiRequestError(
        0,
        ApiErrorCode.INTERNAL_ERROR,
        'Não foi possível falar com o servidor.',
      );
    }

    const body = parseJson(await response.text());
    if (!response.ok) {
      if (isApiError(body)) throw new ApiRequestError(response.status, body.code, body.message);
      throw new ApiRequestError(
        response.status,
        ApiErrorCode.INTERNAL_ERROR,
        'Erro inesperado do servidor.',
      );
    }
    // Confia no contrato da API (tipos de @helpdesk/shared); não há validação em runtime aqui.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return body as T;
  };
}
