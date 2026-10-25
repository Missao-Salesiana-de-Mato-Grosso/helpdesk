/// <reference types="multer" />
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  UseInterceptors,
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type PipeTransform,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, ApiErrorCode } from '@helpdesk/shared';
import { catchError, type Observable } from 'rxjs';
import type { z } from 'zod';
import { ApiException } from '../common/api-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { fileTooLarge, tooManyFiles, type IncomingFile } from './attachments.service.js';

/** Campo multipart dos arquivos. O JSON da requisição vai no campo `data`. */
export const FILES_FIELD = 'files';

/** Traduz os erros do multer para os códigos da API. */
@Injectable()
class UploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof PayloadTooLargeException) throw fileTooLarge();
        if (error instanceof BadRequestException) {
          // O multer só chega aqui com arquivos demais (acima do 1 a mais que aceitamos contar)
          // ou multipart malformado.
          if (/too many files|unexpected/i.test(error.message)) throw tooManyFiles();
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            ApiErrorCode.VALIDATION_ERROR,
            'Envio de arquivos inválido.',
          );
        }
        throw error;
      }),
    );
  }
}

/**
 * Aceita `multipart/form-data` com até `ATTACHMENT_MAX_FILES` arquivos no campo `files`, em
 * memória (20 MB cada). O multer conta 1 a mais para o serviço responder TOO_MANY_FILES com a
 * mensagem certa. Requisições JSON continuam funcionando.
 */
export function AcceptsAttachments() {
  return applyDecorators(
    UseInterceptors(
      UploadErrorsInterceptor,
      FilesInterceptor(FILES_FIELD, ATTACHMENT_MAX_FILES + 1, {
        limits: {
          fileSize: ATTACHMENT_MAX_BYTES,
          files: ATTACHMENT_MAX_FILES + 1,
          fields: 1,
          fieldSize: 1024 * 1024,
        },
        defParamCharset: 'utf8',
      }),
    ),
  );
}

/** `Express.Multer.File[]` → o formato do `AttachmentsService`. */
export const incomingFiles = (files: Express.Multer.File[] | undefined): IncomingFile[] =>
  (files ?? []).map((file) => ({ filename: file.originalname, buffer: file.buffer }));

/** Corpo JSON ou, em multipart, o JSON do campo `data`, validado pelo schema. */
export class JsonOrMultipartPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<T>
> {
  private readonly zod: ZodValidationPipe<T>;

  constructor(schema: T) {
    this.zod = new ZodValidationPipe(schema);
  }

  transform(value: unknown): z.infer<T> {
    return this.zod.transform(unwrapMultipart(value));
  }
}

function unwrapMultipart(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('data' in value)) return value;
  if (Object.keys(value).length !== 1 || typeof value.data !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value.data);
    return parsed;
  } catch {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ApiErrorCode.VALIDATION_ERROR,
      'data: JSON inválido',
    );
  }
}
