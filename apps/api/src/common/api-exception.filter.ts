import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiErrorCode, type ApiError } from '@helpdesk/shared';
import type { Response } from 'express';
import { ApiException } from './api-exception.js';

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ApiErrorCode.VALIDATION_ERROR,
  [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ApiErrorCode.VALIDATION_ERROR,
};

// Toda resposta de erro sai no formato { statusCode, code, message }. Nada de stack no corpo.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode === 401) {
      response.setHeader('WWW-Authenticate', 'Bearer');
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof ApiException) {
      return { statusCode: exception.statusCode, code: exception.code, message: exception.message };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: CODE_BY_STATUS[statusCode] ?? ApiErrorCode.INTERNAL_ERROR,
        message: exception.message,
      };
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'Erro interno.',
    };
  }
}
