import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { UsersService } from './users.service.js';

/** T22 RN-19: pedidos `pending` sem decisão há `ACCESS_REQUEST_TRASH_DAYS` vão para a lixeira. */
@Injectable()
export class AccessRequestsCron {
  private readonly logger = new Logger(AccessRequestsCron.name);
  private readonly trashDays: number;
  private running = false;

  constructor(
    private readonly users: UsersService,
    config: ConfigService<Env, true>,
  ) {
    this.trashDays = config.get('ACCESS_REQUEST_TRASH_DAYS', { infer: true });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'access-requests-trash' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const trashed = await this.users.trashExpiredPendingRequests(this.trashDays);
      if (trashed > 0)
        this.logger.log(`Lixeira: ${trashed} pedido(s) sem decisão há ${this.trashDays}+ dias`);
    } catch (error) {
      this.logger.error(
        `Ciclo da lixeira de pedidos falhou: ${error instanceof Error ? error.message : 'erro'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
