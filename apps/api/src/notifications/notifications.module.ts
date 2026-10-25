import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import type { Env } from '../config/env.js';
import { GroupsModule } from '../groups/groups.module.js';
import { UsersModule } from '../users/users.module.js';
import { MAILER, NodemailerMailer, type Mailer } from './mailer.js';
import { NotificationService } from './notification.service.js';
import { NotificationsCron } from './notifications.cron.js';

@Module({
  imports: [UsersModule, GroupsModule, CompaniesModule, CategoriesModule, AttachmentsModule],
  providers: [
    NotificationService,
    NotificationsCron,
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Mailer =>
        new NodemailerMailer({
          host: config.get('SMTP_HOST', { infer: true }),
          port: config.get('SMTP_PORT', { infer: true }),
          secure: config.get('SMTP_SECURE', { infer: true }),
          user: config.get('SMTP_USER', { infer: true }),
          password: config.get('SMTP_PASSWORD', { infer: true }),
        }),
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
