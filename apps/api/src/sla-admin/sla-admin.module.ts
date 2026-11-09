import { Module } from '@nestjs/common';
import { SlaModule } from '../sla/sla.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { SlaAdminController } from './sla-admin.controller.js';

/** Separado do SlaModule, que o TicketsModule importa: assim o controller usa os dois sem ciclo. */
@Module({
  imports: [SlaModule, TicketsModule],
  controllers: [SlaAdminController],
})
export class SlaAdminModule {}
