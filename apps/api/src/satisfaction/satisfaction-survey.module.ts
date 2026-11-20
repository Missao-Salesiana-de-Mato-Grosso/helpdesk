import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { SatisfactionSurveyController } from './satisfaction-survey.controller.js';
import { SatisfactionModule } from './satisfaction.module.js';

/**
 * T40: rotas públicas da avaliação. Separado do `SatisfactionModule` porque precisa do
 * `TicketsService` (número e assunto), e os chamados já dependem do `SatisfactionModule`.
 */
@Module({
  imports: [SatisfactionModule, TicketsModule],
  controllers: [SatisfactionSurveyController],
})
export class SatisfactionSurveyModule {}
