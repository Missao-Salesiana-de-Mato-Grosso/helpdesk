import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service.js';

@Module({
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
