import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';

/**
 * T28: na subida, calcula o prazo dos tickets que ainda não têm (os de antes da T28). Idempotente:
 * depois da primeira vez não encontra nada. Falha não impede a API de subir.
 */
@Injectable()
export class SlaBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(SlaBackfill.name);

  constructor(private readonly tickets: TicketsService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const updated = await this.tickets.recomputeSla(true);
      if (updated > 0) this.logger.log(`SLA calculado para ${updated} ticket(s) sem prazo`);
    } catch (error) {
      this.logger.error(
        `Backfill do SLA falhou: ${error instanceof Error ? error.message : 'erro'}`,
      );
    }
  }
}
