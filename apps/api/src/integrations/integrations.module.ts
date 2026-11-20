import { Module } from '@nestjs/common';
import { UserCacheModule } from '../auth/user-cache.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { UsersModule } from '../users/users.module.js';
import { ZitadelEventsController } from './zitadel-events.controller.js';
import { ZitadelEventsService } from './zitadel-events.service.js';

/** T39: integrações que chamam a API de fora (hoje, só o Zitadel). */
@Module({
  imports: [UsersModule, TicketsModule, UserCacheModule],
  controllers: [ZitadelEventsController],
  providers: [ZitadelEventsService],
})
export class IntegrationsModule {}
