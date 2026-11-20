import { z } from 'zod';
import type { TicketPriority, TicketSource } from './tickets.js';

// T37: relatórios de atendimento (supervisor e admin).

/** Maior período aceito, contando as duas pontas (RN-02). */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dia que existe no calendário (recusa 30/02, que o `Date` jogaria para março). */
function isRealDay(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

// O zod roda todas as checagens mesmo depois de uma falhar: cada uma precisa aguentar lixo.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
  .refine(isRealDay, 'Data inválida.');

/** Dias do período, contando as duas pontas. */
export function reportDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

const periodFields = {
  from: isoDate,
  to: isoDate,
  groupId: z.uuid().optional(),
};

type Period = { from: string; to: string };

/** "Até" depois de "de" e no máximo 366 dias (RN-02). */
function withPeriodChecks<T extends z.ZodType<Period>>(schema: T) {
  return schema
    .refine(({ from, to }) => from <= to, {
      message: 'A data final vem antes da inicial.',
      path: ['to'],
    })
    .refine(({ from, to }) => reportDays(from, to) <= MAX_REPORT_DAYS, {
      message: `O período pode ter no máximo ${MAX_REPORT_DAYS} dias.`,
      path: ['to'],
    });
}

/** `GET /api/reports/summary` (RN-02). Datas no fuso do horário comercial. */
export const reportQuerySchema = withPeriodChecks(z.object(periodFields).strict());
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Mediana e média em minutos úteis, e quantos chamados entraram no cálculo (RN-08). */
export interface ReportDuration {
  median: number | null;
  average: number | null;
  count: number;
}

/** Cumpridos sobre avaliados (RN-11). */
export interface ReportRate {
  met: number;
  evaluated: number;
}

/**
 * T40 RN-19: avaliações com `rated_at` no período (`responses`), quantas foram 4 ou 5
 * (`satisfied`) e a média com uma casa; links enviados no período (`requested`) e quantos deles já
 * foram respondidos (`answered`).
 */
export interface ReportSatisfaction {
  responses: number;
  satisfied: number;
  average: number | null;
  requested: number;
  answered: number;
}

export interface ReportMetrics {
  created: number;
  resolved: number;
  closed: number;
  firstResponse: ReportDuration;
  resolution: ReportDuration;
  firstResponseSla: ReportRate;
  resolutionSla: ReportRate;
  satisfaction: ReportSatisfaction;
}

/** Linha de uma quebra (RN-12). `id` nulo = "Sem responsável" ou "Sem unidade". */
export interface ReportRow extends ReportMetrics {
  id: string | null;
  name: string;
  active: boolean;
}

export interface ReportPoint {
  /** Dia (ou a segunda-feira da semana), `AAAA-MM-DD`. */
  date: string;
  created: number;
  resolved: number;
}

export interface ReportSummary {
  from: string;
  to: string;
  groupId: string | null;
  bucket: 'day' | 'week';
  totals: ReportMetrics & { openNow: number };
  series: ReportPoint[];
  byGroup: ReportRow[];
  byAgent: ReportRow[];
  byCompany: ReportRow[];
  byCategory: ReportRow[];
  bySource: { source: TicketSource; count: number }[];
  byPriority: { priority: TicketPriority; count: number }[];
}

/** T40 RN-21: `GET /api/reports/satisfaction`. `low=true` = só notas 1 e 2. */
export const satisfactionReportQuerySchema = withPeriodChecks(
  z
    .object({
      ...periodFields,
      low: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
    })
    .strict(),
);
export type SatisfactionReportQuery = z.infer<typeof satisfactionReportQuerySchema>;

/** Teto da lista (RN-21). */
export const MAX_SATISFACTION_REPORT_ITEMS = 500;

export interface SatisfactionReportItem {
  ticketId: string;
  ticketNumber: number;
  ticketSubject: string;
  score: number;
  comment: string | null;
  ratedAt: string;
  assignee: { id: string; name: string } | null;
  group: { id: string; name: string };
}

export interface SatisfactionReport {
  items: SatisfactionReportItem[];
  /** Havia mais avaliações que o teto: a lista traz as mais recentes. */
  truncated: boolean;
}
