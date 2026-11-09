import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  createHolidaySchema,
  updateBusinessHoursSchema,
  updateSlaPoliciesSchema,
  type CreateHolidayInput,
  type Holiday,
  type SlaSettings,
  type UpdateBusinessHoursInput,
  type UpdateSlaPoliciesInput,
} from '@helpdesk/shared';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlaService } from '../sla/sla.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

/**
 * T28: metas, horário comercial e feriados — só admin. Toda mudança recalcula os prazos dos tickets
 * não fechados (fechados guardam o prazo que tinham).
 */
@Controller('admin')
@Roles('admin')
export class SlaAdminController {
  constructor(
    private readonly sla: SlaService,
    private readonly tickets: TicketsService,
  ) {}

  @Get('sla')
  settings(): Promise<SlaSettings> {
    return this.sla.settings();
  }

  @Put('sla/policies')
  async updatePolicies(
    @Body(new ZodValidationPipe(updateSlaPoliciesSchema)) body: UpdateSlaPoliciesInput,
  ): Promise<SlaSettings> {
    await this.sla.updatePolicies(body);
    await this.tickets.recomputeSla();
    return this.sla.settings();
  }

  @Put('sla/hours')
  async updateHours(
    @Body(new ZodValidationPipe(updateBusinessHoursSchema)) body: UpdateBusinessHoursInput,
  ): Promise<SlaSettings> {
    await this.sla.updateHours(body);
    await this.tickets.recomputeSla();
    return this.sla.settings();
  }

  @Get('holidays')
  listHolidays(): Promise<Holiday[]> {
    return this.sla.listHolidays();
  }

  @Post('holidays')
  async createHoliday(
    @Body(new ZodValidationPipe(createHolidaySchema)) body: CreateHolidayInput,
  ): Promise<Holiday> {
    const holiday = await this.sla.createHoliday(body);
    await this.tickets.recomputeSla();
    return holiday;
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  async deleteHoliday(@Param('id') id: string): Promise<void> {
    await this.sla.deleteHoliday(id);
    await this.tickets.recomputeSla();
  }
}
