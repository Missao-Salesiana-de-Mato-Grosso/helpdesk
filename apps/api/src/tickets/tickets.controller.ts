import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
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
import type { Request } from 'express';
import type { CurrentUser as CurrentUserType } from '../auth/current-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { clientIp } from '../common/client-ip.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TicketsService } from './tickets.service.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketData,
    @Req() request: Request,
  ): Promise<TicketDetail> {
    return this.tickets.create(user, body, clientIp(request));
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
  addMessage(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createMessageSchema)) body: CreateMessageInput,
    @Req() request: Request,
  ): Promise<TicketDetail> {
    return this.tickets.addMessage(user, id, body, clientIp(request));
  }
}
