import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ApiErrorCode } from '@helpdesk/shared';
import type { z } from 'zod';
import { ApiException } from './api-exception.js';

/** Valida o valor com um schema zod de `@helpdesk/shared`. Falha → 422 VALIDATION_ERROR. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(corpo)'}: ${issue.message}`)
        .join('; ');
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.VALIDATION_ERROR,
        message,
      );
    }
    return result.data;
  }
}
