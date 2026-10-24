import { HttpException } from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@helpdesk/shared';

/** Erro de negócio da API. O filtro global o serializa como `ApiError`. */
export class ApiException extends HttpException {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super({ statusCode, code, message } satisfies ApiError, statusCode);
  }
}
