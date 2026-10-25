/// <reference types="multer" />
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
} from '@nestjs/common';
import {
  createMessageSchema,
  createTicketSchema,
  updateTicketSchema,
  type CreateMessageInput,
  listTicketsQuerySchema,
  type CreateTicketData,
  type ListTicketsQuery,
  type TicketCounters,
  type TicketDetail,
  type TicketListResponse,
  type UpdateTicketInput,
} from '@helpdesk/shared';
import type { Request, Response } from 'express';
import { AcceptsAttachments, JsonOrMultipartPipe, incomingFiles } from '../attachments/upload.js';
import type { CurrentUser as CurrentUserType } from '../auth/current-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { clientIp } from '../common/client-ip.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TicketsService } from './tickets.service.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @AcceptsAttachments()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body(new JsonOrMultipartPipe(createTicketSchema)) body: CreateTicketData,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() request: Request,
  ): Promise<TicketDetail> {
    return this.tickets.create(user, body, clientIp(request), incomingFiles(files));
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query(new ZodValidationPipe(listTicketsQuerySchema)) query: ListTicketsQuery,
  ): Promise<TicketListResponse> {
    return this.tickets.list(user, query);
  }

  @Get('counters')
  @Roles('agente', 'supervisor', 'admin')
  counters(@CurrentUser() user: CurrentUserType): Promise<TicketCounters> {
    return this.tickets.counters(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: CurrentUserType, @Param('id') id: string): Promise<TicketDetail> {
    return this.tickets.detail(user, id);
  }

  @Patch(':id')
  @Roles('agente', 'supervisor', 'admin')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTicketSchema)) body: UpdateTicketInput,
    @Req() request: Request,
  ): Promise<TicketDetail> {
    return this.tickets.update(user, id, body, clientIp(request));
  }

  @Post(':id/messages')
  @AcceptsAttachments()
  addMessage(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body(new JsonOrMultipartPipe(createMessageSchema)) body: CreateMessageInput,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() request: Request,
  ): Promise<TicketDetail> {
    return this.tickets.addMessage(user, id, body, clientIp(request), incomingFiles(files));
  }
}

/** `filename*` (RFC 5987) com o nome real e um `filename` ASCII de reserva. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly tickets: TicketsService) {}

  /** Download por stream, sempre como anexo e com `nosniff` (o navegador nunca renderiza). */
  @Get(':id')
  async download(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { attachment, stream } = await this.tickets.openAttachment(user, id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, {
      type: attachment.mimeType,
      length: attachment.sizeBytes,
      disposition: contentDisposition(attachment.filename),
    });
  }
}
