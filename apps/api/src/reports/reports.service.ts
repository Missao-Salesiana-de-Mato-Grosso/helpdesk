import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LOW_MAX_SCORE,
  MAX_SATISFACTION_REPORT_ITEMS,
  type ReportQuery,
  type ReportSummary,
  type SatisfactionReport,
  type SatisfactionReportQuery,
} from '@helpdesk/shared';
import { CategoriesService } from '../categories/categories.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { Env } from '../config/env.js';
import { GroupsService } from '../groups/groups.service.js';
import { SatisfactionService } from '../satisfaction/satisfaction.service.js';
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
    private readonly satisfaction: SatisfactionService,
    config: ConfigService<Env, true>,
  ) {
    this.timeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async summary(query: ReportQuery, now = new Date()): Promise<ReportSummary> {
    const groupId = query.groupId ?? null;
    const { start, end } = this.period(query);
    // T40 RN-19: avaliado ou com link enviado no período, mesmo sem outro marco nele.
    const ratings = await this.satisfaction.forReport(start, end);
    const [{ tickets, openNow }, context] = await Promise.all([
      this.tickets.reportData(
        start,
        end,
        groupId,
        ratings.map((rating) => rating.ticketId),
      ),
      this.sla.context(),
    ]);
    const ratingOf = new Map(ratings.map((rating) => [rating.ticketId, rating]));
    // Sem horário comercial não há horário útil para medir (§8): tempos sem valor.
    const calendar = context.calendar.intervals.length > 0 ? context.calendar : null;
    const window: ReportWindow = { start, end, now, calendar };
    const rows: ReportTicket[] = tickets.map((ticket) => ({
      ...ticket,
      satisfaction: ratingOf.get(ticket.id) ?? null,
    }));

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

  /**
   * T40 RN-21 e RN-22: avaliações dadas no período, da mais recente para a mais antiga, no grupo
   * atual do chamado; `low` = só notas 1 e 2. No máximo 500.
   */
  async satisfactionList(query: SatisfactionReportQuery): Promise<SatisfactionReport> {
    const { start, end } = this.period(query);
    const rated = (await this.satisfaction.forReport(start, end)).flatMap(
      ({ ticketId, score, comment, ratedAt }) =>
        score !== null &&
        ratedAt !== null &&
        ratedAt >= start &&
        ratedAt < end &&
        (!query.low || score <= LOW_MAX_SCORE)
          ? [{ ticketId, score, comment, ratedAt }]
          : [],
    );
    const tickets = new Map(
      (await this.tickets.summariesByIds(rated.map((row) => row.ticketId))).map((ticket) => [
        ticket.id,
        ticket,
      ]),
    );
    const matching = rated
      .flatMap((row) => {
        const ticket = tickets.get(row.ticketId);
        if (!ticket || (query.groupId && ticket.groupId !== query.groupId)) return [];
        return [{ row, ticket }];
      })
      .toSorted((a, b) => b.row.ratedAt.getTime() - a.row.ratedAt.getTime());
    const page = matching.slice(0, MAX_SATISFACTION_REPORT_ITEMS);

    const [agents, groups] = await Promise.all([
      this.users.refsByIds(distinct(page.map(({ ticket }) => ticket.assigneeId))),
      this.groups.refsByIds(distinct(page.map(({ ticket }) => ticket.groupId))),
    ]);
    const agentOf = byId(agents);
    const groupOf = byId(groups);
    return {
      items: page.map(({ row, ticket }) => {
        const agent = ticket.assigneeId ? agentOf.get(ticket.assigneeId) : undefined;
        return {
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          ticketSubject: ticket.subject,
          score: row.score,
          comment: row.comment,
          ratedAt: row.ratedAt.toISOString(),
          assignee: agent ? { id: agent.id, name: agent.name } : null,
          group: { id: ticket.groupId, name: groupOf.get(ticket.groupId)?.name ?? 'Item removido' },
        };
      }),
      truncated: matching.length > page.length,
    };
  }

  /** `[start, end)` do período em instantes UTC, no fuso do horário comercial (T37 RN-02). */
  private period(query: { from: string; to: string }): { start: Date; end: Date } {
    return {
      start: startOfLocalDay(query.from, this.timeZone),
      end: startOfLocalDay(nextDay(query.to), this.timeZone),
    };
  }
}
