import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { TicketsService } from './tickets.service.js';

/** T27: ticket resolvido há `AUTO_CLOSE_DAYS` dias passa para fechado. `0` desliga. */
@Injectable()
export class AutoCloseCron {
  private readonly logger = new Logger(AutoCloseCron.name);
  private readonly days: number;
  private running = false;

  constructor(
    private readonly tickets: TicketsService,
    config: ConfigService<Env, true>,
  ) {
    this.days = config.get('AUTO_CLOSE_DAYS', { infer: true });
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'tickets-auto-close' })
  async tick(): Promise<void> {
    if (this.days === 0 || this.running) return;
    this.running = true;
    try {
      const closed = await this.tickets.closeExpiredResolved(this.days);
      if (closed > 0)
        this.logger.log(
          `Fechamento automático: ${closed} ticket(s) resolvido(s) há ${this.days}+ dias`,
        );
    } catch (error) {
      this.logger.error(
        `Ciclo do fechamento automático falhou: ${error instanceof Error ? error.message : 'erro'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
