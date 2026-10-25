import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { InboundEmailService } from './inbound-email.service.js';

/** RN-01: leitura da caixa a cada minuto. Um ciclo não começa enquanto o anterior roda. */
@Injectable()
export class InboundEmailCron {
  private readonly logger = new Logger(InboundEmailCron.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly inbound: InboundEmailService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('INBOUND_ENABLED', { infer: true });
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'inbound-email' })
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const r = await this.inbound.pollMailbox();
      if (r.processed + r.discarded + r.failed + r.duplicates > 0) {
        this.logger.log(
          `Caixa: ${r.processed} processados, ${r.discarded} descartados, ${r.failed} com falha, ${r.duplicates} repetidos`,
        );
      }
    } catch (error) {
      // RN-04: o cursor não avançou; o próximo minuto tenta de novo.
      this.logger.error(
        `Ciclo da caixa interrompido: ${error instanceof Error ? error.message : 'erro'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
