import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReportQuery, ReportSummary } from '@helpdesk/shared';
import { CategoriesService } from '../categories/categories.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { Env } from '../config/env.js';
import { GroupsService } from '../groups/groups.service.js';
import { startOfLocalDay } from '../sla/business-time.js';
import { SlaService } from '../sla/sla.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { UsersService } from '../users/users.service.js';
import {
  breakdown,
  buildSeries,
  distributions,
  reportMetrics,
  type ReportRef,
  type ReportTicket,
  type ReportWindow,
} from './report-math.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

const distinct = (values: readonly (string | null)[]) =>
  [...new Set(values)].filter((value): value is string => value !== null);

const byId = (refs: readonly ReportRef[]) => new Map(refs.map((ref) => [ref.id, ref]));

/**
 * T37: relatório de atendimento de um período. Lê os chamados pelo TicketsService e o calendário
 * pelo SlaService; os números são calculados em memória (report-math), sem conteúdo de chamado.
 */
@Injectable()
export class ReportsService {
  private readonly timeZone: string;

  constructor(
    private readonly tickets: TicketsService,
    private readonly sla: SlaService,
    private readonly groups: GroupsService,
    private readonly users: UsersService,
    private readonly companies: CompaniesService,
    private readonly categories: CategoriesService,
    config: ConfigService<Env, true>,
  ) {
    this.timeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async summary(query: ReportQuery, now = new Date()): Promise<ReportSummary> {
    const groupId = query.groupId ?? null;
    const start = startOfLocalDay(query.from, this.timeZone);
    const end = startOfLocalDay(nextDay(query.to), this.timeZone);
    const [{ tickets, openNow }, context] = await Promise.all([
      this.tickets.reportData(start, end, groupId),
      this.sla.context(),
    ]);
    // Sem horário comercial não há horário útil para medir (§8): tempos sem valor.
    const calendar = context.calendar.intervals.length > 0 ? context.calendar : null;
    const window: ReportWindow = { start, end, now, calendar };
    const rows: ReportTicket[] = tickets;

    const [groups, agents, companies, categories] = await Promise.all([
      this.groups.refsByIds(distinct(rows.map((t) => t.groupId))),
      this.users.refsByIds(distinct(rows.map((t) => t.assigneeId))),
      this.companies.refsByIds(distinct(rows.map((t) => t.companyId))),
      this.categories.refsByIds(distinct(rows.map((t) => t.categoryId))),
    ]);
    const series = buildSeries(rows, query.from, query.to, this.timeZone);

    return {
      from: query.from,
      to: query.to,
      groupId,
      bucket: series.bucket,
      totals: { ...reportMetrics(rows, window), openNow },
      series: series.points,
      byGroup: breakdown(rows, (t) => t.groupId, byId(groups), 'Sem grupo', window),
      byAgent: breakdown(rows, (t) => t.assigneeId, byId(agents), 'Sem responsável', window),
      byCompany: breakdown(rows, (t) => t.companyId, byId(companies), 'Sem unidade', window),
      byCategory: breakdown(rows, (t) => t.categoryId, byId(categories), 'Sem categoria', window),
      ...distributions(rows, window),
    };
  }
}
