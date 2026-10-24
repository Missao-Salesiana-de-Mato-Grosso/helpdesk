import { HttpException } from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@helpdesk/shared';

/** Erro de negócio da API. O filtro global o serializa como `ApiError`. */
export class ApiException extends HttpException {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Campos extras no corpo do erro (ex.: `currentVersion` no 409 de versão). */
    readonly details: Record<string, unknown> = {},
  ) {
    super({ ...details, statusCode, code, message } satisfies ApiError, statusCode);
  }
}
