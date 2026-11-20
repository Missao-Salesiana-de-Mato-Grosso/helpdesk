import { Module } from '@nestjs/common';
import { SatisfactionService } from './satisfaction.service.js';

/**
 * T40: a tabela `ticket_satisfaction`. Usado pelas notificações (link na resolução), pelos chamados
 * (painel) e pelos relatórios. As rotas públicas ficam no `SatisfactionSurveyModule`.
 */
@Module({
  providers: [SatisfactionService],
  exports: [SatisfactionService],
})
export class SatisfactionModule {}
