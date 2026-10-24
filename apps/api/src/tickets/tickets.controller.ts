import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  createTicketSchema,
  listTicketsQuerySchema,
  type CreateTicketData,
  type ListTicketsQuery,
  type TicketCounters,
  type TicketDetail,
  type TicketListResponse,
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
}
