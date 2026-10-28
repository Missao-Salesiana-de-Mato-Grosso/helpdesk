import { Module } from '@nestjs/common';
import { AccessRequestsCron } from './access-requests.cron.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, AccessRequestsCron],
  exports: [UsersService],
})
export class UsersModule {}
