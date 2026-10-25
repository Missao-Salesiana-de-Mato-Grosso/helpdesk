import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { NotificationService } from './notification.service.js';

/** RN-12: entrega da outbox a cada minuto. Um ciclo não começa enquanto o anterior roda. */
@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly notifications: NotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('NOTIFICATIONS_ENABLED', { infer: true });
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notifications-outbox' })
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const result = await this.notifications.processOutbox();
      if (result.sent + result.failed + result.retried > 0) {
        this.logger.log(
          `Outbox: ${result.sent} enviadas, ${result.retried} para nova tentativa, ${result.failed} com falha`,
        );
      }
    } catch (error) {
      // RN-15: nunca derruba a API.
      this.logger.error(
        `Ciclo da outbox falhou: ${error instanceof Error ? error.message : 'erro'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
