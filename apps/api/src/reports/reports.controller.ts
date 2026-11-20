import { Controller, Get, Query } from '@nestjs/common';
import {
  reportQuerySchema,
  satisfactionReportQuerySchema,
  type ReportQuery,
  type ReportSummary,
  type SatisfactionReport,
  type SatisfactionReportQuery,
} from '@helpdesk/shared';
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

  /** T40 RN-21: a lista das avaliações do período. */
  @Get('satisfaction')
  satisfaction(
    @Query(new ZodValidationPipe(satisfactionReportQuerySchema)) query: SatisfactionReportQuery,
  ): Promise<SatisfactionReport> {
    return this.reports.satisfactionList(query);
  }
}
