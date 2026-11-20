import { Body, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiErrorCode,
  satisfactionLookupSchema,
  satisfactionRateSchema,
  type SatisfactionLookupInput,
  type SatisfactionRateData,
  type SatisfactionSurvey,
} from '@helpdesk/shared';
import { Public } from '../auth/decorators.js';
import { ApiException } from '../common/api-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { SatisfactionService, type SurveyRecord } from './satisfaction.service.js';

/** RN-13: 30 requisições por minuto por IP, além do limite global. */
const SURVEY_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

const linkInvalid = () =>
  new ApiException(
    HttpStatus.NOT_FOUND,
    ApiErrorCode.SURVEY_LINK_INVALID,
    'Este link de avaliação expirou ou foi substituído por um mais novo.',
  );

/**
 * T40: a página pública de avaliação. Sem login: o token do link (no corpo, nunca na URL, RN-07)
 * é a única credencial, e só dá acesso à avaliação do próprio chamado.
 */
@Controller('satisfaction')
@Throttle(SURVEY_THROTTLE)
export class SatisfactionSurveyController {
  constructor(
    private readonly satisfaction: SatisfactionService,
    private readonly tickets: TicketsService,
  ) {}

  /** RN-08 e RN-13: o que a página mostra. Não grava nada. */
  @Public()
  @Post('lookup')
  @HttpCode(200)
  async lookup(
    @Body(new ZodValidationPipe(satisfactionLookupSchema)) body: SatisfactionLookupInput,
  ): Promise<SatisfactionSurvey> {
    return this.view(await this.satisfaction.findByToken(body.token));
  }

  /** RN-10, RN-11 e RN-15: grava ou substitui a avaliação. */
  @Public()
  @Put()
  async rate(
    @Body(new ZodValidationPipe(satisfactionRateSchema)) body: SatisfactionRateData,
  ): Promise<SatisfactionSurvey> {
    return this.view(await this.satisfaction.rate(body.token, body));
  }

  private async view(record: SurveyRecord | null): Promise<SatisfactionSurvey> {
    if (!record) throw linkInvalid();
    const ticket = await this.tickets.surveyHeader(record.ticketId);
    if (!ticket) throw linkInvalid();
    return {
      ticketNumber: ticket.number,
      ticketSubject: ticket.subject,
      score: record.score,
      comment: record.comment,
      ratedAt: record.ratedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt.toISOString(),
    };
  }
}
