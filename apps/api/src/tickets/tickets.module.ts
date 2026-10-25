import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { UsersModule } from '../users/users.module.js';
import { AttachmentsController, TicketsController } from './tickets.controller.js';
import { TicketEventsRepository, TicketsRepository } from './tickets.repository.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [AttachmentsModule, UsersModule, CategoriesModule, CompaniesModule, GroupsModule],
  controllers: [TicketsController, AttachmentsController],
  providers: [TicketsService, TicketsRepository, TicketEventsRepository],
  exports: [TicketsService],
})
export class TicketsModule {}
