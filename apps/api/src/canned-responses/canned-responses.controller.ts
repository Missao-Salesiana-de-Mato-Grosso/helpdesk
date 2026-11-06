import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createCannedResponseSchema,
  updateCannedResponseSchema,
  type CannedResponse,
  type CreateCannedResponseInput,
  type UpdateCannedResponseInput,
} from '@helpdesk/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { CurrentUser as CurrentUserType } from '../auth/current-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CannedResponsesService } from './canned-responses.service.js';

/** T26: todo agente usa as respostas prontas; só admin e supervisor as mantêm. */
@Controller('canned-responses')
@Roles('agente', 'supervisor', 'admin')
export class CannedResponsesController {
  constructor(private readonly canned: CannedResponsesService) {}

  @Get()
  list(): Promise<CannedResponse[]> {
    return this.canned.list();
  }

  @Post()
  @Roles('supervisor', 'admin')
  create(
    @Body(new ZodValidationPipe(createCannedResponseSchema)) body: CreateCannedResponseInput,
    @CurrentUser() user: CurrentUserType,
  ): Promise<CannedResponse> {
    return this.canned.create(body, user.id);
  }

  @Patch(':id')
  @Roles('supervisor', 'admin')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCannedResponseSchema)) body: UpdateCannedResponseInput,
  ): Promise<CannedResponse> {
    return this.canned.update(id, body);
  }

  @Delete(':id')
  @Roles('supervisor', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.canned.remove(id);
  }
}
