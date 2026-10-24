import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { UsersModule } from '../users/users.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketEventsRepository, TicketsRepository } from './tickets.repository.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [UsersModule, CategoriesModule, CompaniesModule, GroupsModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsRepository, TicketEventsRepository],
  exports: [TicketsService],
})
export class TicketsModule {}
