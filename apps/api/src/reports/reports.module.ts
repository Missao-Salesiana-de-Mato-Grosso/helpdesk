import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { SlaModule } from '../sla/sla.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { UsersModule } from '../users/users.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [TicketsModule, SlaModule, GroupsModule, UsersModule, CompaniesModule, CategoriesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
