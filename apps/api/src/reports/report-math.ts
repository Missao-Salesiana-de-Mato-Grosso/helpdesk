import {
  TICKET_PRIORITIES,
  TICKET_SOURCES,
  type ReportDuration,
  type ReportMetrics,
  type ReportPoint,
  type ReportRate,
  type ReportRow,
  type TicketPriority,
  type TicketSource,
  type TicketStatus,
} from '@helpdesk/shared';
import { businessMinutesBetween, localDate, type BusinessCalendar } from '../sla/business-time.js';

/** O que o relatório lê de cada chamado (RN-17: nada de assunto, solicitante ou conteúdo). */
export interface ReportTicket {
  groupId: string;
  assigneeId: string | null;
  companyId: string | null;
  categoryId: string;
  source: TicketSource;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  slaPausedMinutes: number;
}

/**
 * Período `[start, end)` em instantes UTC, o "agora" (prazos vencidos) e o calendário do horário
 * útil. `calendar` nulo = sem horário comercial cadastrado: os tempos ficam sem valor.
 */
export interface ReportWindow {
  start: Date;
  end: Date;
  now: Date;
  calendar: BusinessCalendar | null;
}

/** Item de uma quebra: id, nome e se está ativo. */
export interface ReportRef {
  id: string;
  name: string;
  active: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Acima disso, a evolução é por semana (RN-15). */
const MAX_DAILY_POINTS = 62;

const within = (date: Date | null, window: ReportWindow): date is Date =>
  date !== null && date >= window.start && date < window.end;

/** Mediana e média arredondadas ao minuto (RN-08). */
export function summarize(values: readonly number[]): ReportDuration {
  if (values.length === 0) return { median: null, average: null, count: 0 };
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return { median: Math.round(median), average: Math.round(average), count: sorted.length };
}

/**
 * Minutos úteis até a 1ª resposta (RN-06) e até a resolução, descontado o tempo pausado (RN-07).
 * `null` quando o marco não aconteceu ou não há calendário.
 */
export function ticketDurations(
  ticket: Pick<ReportTicket, 'createdAt' | 'firstResponseAt' | 'resolvedAt' | 'slaPausedMinutes'>,
  calendar: BusinessCalendar | null,
): { firstResponse: number | null; resolution: number | null } {
  if (!calendar) return { firstResponse: null, resolution: null };
  return {
    firstResponse: ticket.firstResponseAt
      ? businessMinutesBetween(ticket.createdAt, ticket.firstResponseAt, calendar)
      : null,
    resolution: ticket.resolvedAt
      ? Math.max(
          0,
          businessMinutesBetween(ticket.createdAt, ticket.resolvedAt, calendar) -
            ticket.slaPausedMinutes,
        )
      : null,
  };
}

/**
 * RN-09 e RN-10: o chamado conta no SLA do período se o marco aconteceu no período (cumprido se
 * não passou do prazo), ou se ainda está pendente de acontecer e o prazo venceu no período.
 */
export function slaOutcome(
  at: Date | null,
  due: Date | null,
  awaiting: boolean,
  window: ReportWindow,
): 'met' | 'missed' | null {
  if (!due) return null;
  if (at) {
    if (!within(at, window)) return null;
    return at <= due ? 'met' : 'missed';
  }
  return awaiting && within(due, window) && due < window.now ? 'missed' : null;
}

function rate(outcomes: readonly ('met' | 'missed' | null)[]): ReportRate {
  const evaluated = outcomes.filter((outcome) => outcome !== null);
  return {
    met: evaluated.filter((outcome) => outcome === 'met').length,
    evaluated: evaluated.length,
  };
}

/** RN-04 a RN-11 para um conjunto de chamados. */
export function reportMetrics(
  tickets: readonly ReportTicket[],
  window: ReportWindow,
): ReportMetrics {
  const firstResponses: number[] = [];
  const resolutions: number[] = [];
  for (const ticket of tickets) {
    const durations = ticketDurations(ticket, window.calendar);
    if (within(ticket.firstResponseAt, window) && durations.firstResponse !== null) {
      firstResponses.push(durations.firstResponse);
    }
    if (within(ticket.resolvedAt, window) && durations.resolution !== null) {
      resolutions.push(durations.resolution);
    }
  }
  const unresolved = (ticket: ReportTicket) =>
    ticket.status === 'open' || ticket.status === 'pending';
  return {
    created: tickets.filter((ticket) => within(ticket.createdAt, window)).length,
    resolved: tickets.filter((ticket) => within(ticket.resolvedAt, window)).length,
    closed: tickets.filter((ticket) => within(ticket.closedAt, window)).length,
    firstResponse: summarize(firstResponses),
    resolution: summarize(resolutions),
    firstResponseSla: rate(
      tickets.map((ticket) =>
        slaOutcome(ticket.firstResponseAt, ticket.firstResponseDueAt, true, window),
      ),
    ),
    resolutionSla: rate(
      tickets.map((ticket) =>
        slaOutcome(ticket.resolvedAt, ticket.resolutionDueAt, unresolved(ticket), window),
      ),
    ),
  };
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Segunda-feira da semana do dia (`AAAA-MM-DD`). */
function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** RN-15: criados e resolvidos por dia, ou por semana acima de 62 dias. */
export function buildSeries(
  tickets: readonly ReportTicket[],
  from: string,
  to: string,
  timeZone: string,
): { bucket: 'day' | 'week'; points: ReportPoint[] } {
  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const bucket = days > MAX_DAILY_POINTS ? 'week' : 'day';
  const keyOf = (date: string) => (bucket === 'week' ? mondayOf(date) : date);
  const points = new Map<string, ReportPoint>();
  for (let day = keyOf(from); day <= to; day = addDays(day, bucket === 'week' ? 7 : 1)) {
    points.set(day, { date: day, created: 0, resolved: 0 });
  }
  const count = (instant: Date | null, field: 'created' | 'resolved') => {
    if (!instant) return;
    const date = localDate(instant, timeZone);
    if (date < from || date > to) return;
    const point = points.get(keyOf(date));
    if (point) point[field] += 1;
  };
  for (const ticket of tickets) {
    count(ticket.createdAt, 'created');
    count(ticket.resolvedAt, 'resolved');
  }
  return { bucket, points: [...points.values()] };
}

/**
 * RN-12: uma linha por valor da chave (`null` vira `emptyName`), só com quem tem algum número no
 * período; ordenada por criados (decrescente) e nome.
 */
export function breakdown(
  tickets: readonly ReportTicket[],
  keyOf: (ticket: ReportTicket) => string | null,
  refs: ReadonlyMap<string, ReportRef>,
  emptyName: string,
  window: ReportWindow,
): ReportRow[] {
  const groups = new Map<string | null, ReportTicket[]>();
  for (const ticket of tickets) {
    const key = keyOf(ticket);
    const list = groups.get(key) ?? [];
    list.push(ticket);
    groups.set(key, list);
  }
  const rows: ReportRow[] = [];
  for (const [key, list] of groups) {
    const metrics = reportMetrics(list, window);
    const empty =
      metrics.created + metrics.resolved + metrics.closed === 0 &&
      metrics.firstResponse.count + metrics.firstResponseSla.evaluated === 0 &&
      metrics.resolutionSla.evaluated === 0;
    if (empty) continue;
    const ref = key === null ? null : refs.get(key);
    rows.push({
      id: key,
      name: key === null ? emptyName : (ref?.name ?? 'Item removido'),
      active: ref?.active ?? true,
      ...metrics,
    });
  }
  return rows.toSorted((a, b) => b.created - a.created || a.name.localeCompare(b.name, 'pt-BR'));
}

/** RN-13: criados no período por canal e por prioridade, na ordem dos enums. */
export function distributions(
  tickets: readonly ReportTicket[],
  window: ReportWindow,
): {
  bySource: { source: TicketSource; count: number }[];
  byPriority: { priority: TicketPriority; count: number }[];
} {
  const created = tickets.filter((ticket) => within(ticket.createdAt, window));
  return {
    bySource: TICKET_SOURCES.map((source) => ({
      source,
      count: created.filter((ticket) => ticket.source === source).length,
    })),
    byPriority: TICKET_PRIORITIES.map((priority) => ({
      priority,
      count: created.filter((ticket) => ticket.priority === priority).length,
    })),
  };
}
