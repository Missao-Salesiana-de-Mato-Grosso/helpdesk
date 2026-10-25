import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import type { Env } from '../config/env.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { UsersModule } from '../users/users.module.js';
import { FolderMailboxSource } from './folder-mailbox.source.js';
import { ImapMailboxSource } from './imap-mailbox.source.js';
import { InboundEmailCron } from './inbound-email.cron.js';
import { InboundEmailService } from './inbound-email.service.js';
import { MAILBOX_SOURCE, type MailboxSource } from './mailbox-source.js';

@Module({
  imports: [TicketsModule, UsersModule, CategoriesModule, AttachmentsModule],
  providers: [
    InboundEmailService,
    InboundEmailCron,
    {
      provide: MAILBOX_SOURCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailboxSource => {
        const since = config.get('MAILBOX_START_SINCE', { infer: true });
        const startSince = since ? new Date(since) : null;
        if (config.get('MAILBOX_DRIVER', { infer: true }) === 'folder') {
          return new FolderMailboxSource(
            config.get('MAILBOX_FOLDER_PATH', { infer: true }),
            startSince,
          );
        }
        // O env já exige MAILBOX_USER e MAILBOX_PASSWORD com o driver imap (config/env.ts).
        return new ImapMailboxSource(
          () =>
            new ImapFlow({
              host: config.get('MAILBOX_HOST', { infer: true }),
              port: config.get('MAILBOX_PORT', { infer: true }),
              secure: true,
              auth: {
                user: config.get('MAILBOX_USER', { infer: true }) ?? '',
                pass: config.get('MAILBOX_PASSWORD', { infer: true }) ?? '',
              },
              // RN-20: o logger do imapflow pode incluir o conteúdo das mensagens.
              logger: false,
            }),
          startSince,
          config.get('MAILBOX_LABEL_PREFIX', { infer: true }),
        );
      },
    },
  ],
  exports: [InboundEmailService],
})
export class InboundEmailModule {}
