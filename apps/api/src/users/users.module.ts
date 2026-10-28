import { Module } from '@nestjs/common';
import { UserCacheModule } from '../auth/user-cache.module.js';
import { AccessRequestsCron } from './access-requests.cron.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  // UserCacheModule é independente do AuthModule: evita um ciclo entre os dois módulos
  // (AuthModule já importa UsersModule pelo UsersService); UsersController precisa do
  // UserCache para invalidar o cache na decisão de acesso (RN-15, T22).
  imports: [UserCacheModule],
  controllers: [UsersController],
  providers: [UsersService, AccessRequestsCron],
  exports: [UsersService],
})
export class UsersModule {}
