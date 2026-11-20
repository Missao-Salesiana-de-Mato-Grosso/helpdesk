import { Controller, Get, Query } from '@nestjs/common';
import { reportQuerySchema, type ReportQuery, type ReportSummary } from '@helpdesk/shared';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReportsService } from './reports.service.js';

/** T37: relatórios de atendimento, só supervisor e admin (RN-01). */
@Controller('reports')
@Roles('supervisor', 'admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
  ): Promise<ReportSummary> {
    return this.reports.summary(query);
  }
}
