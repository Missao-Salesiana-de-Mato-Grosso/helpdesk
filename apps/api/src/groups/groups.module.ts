import { Module } from '@nestjs/common';
import { UserCacheModule } from '../auth/user-cache.module.js';
import { UsersModule } from '../users/users.module.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';

@Module({
  imports: [UsersModule, UserCacheModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
