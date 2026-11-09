import { z } from 'zod';
import { TICKET_PRIORITIES, type TicketPriority } from './tickets.js';

// T28: SLA com horário comercial e feriados. Metas em minutos úteis; o admin mantém.

export interface SlaPolicy {
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

/** Intervalo de horário útil: `weekday` 0 = domingo … 6 = sábado; minutos desde a meia-noite. */
export interface BusinessInterval {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Holiday {
  id: string;
  /** `AAAA-MM-DD`. */
  date: string;
  name: string;
}

/** `GET /api/admin/sla`. */
export interface SlaSettings {
  /** Fuso do horário comercial (`BUSINESS_TIMEZONE`), ex.: `America/Cuiaba`. */
  timeZone: string;
  policies: SlaPolicy[];
  hours: BusinessInterval[];
}

/** Limite de uma meta: 60 dias úteis de 24 h, só para barrar valor absurdo. */
const MAX_TARGET_MINUTES = 60 * 24 * 60;
const minutes = z.number().int().min(1).max(MAX_TARGET_MINUTES);

/** `PUT /api/admin/sla/policies`: as quatro prioridades, cada uma uma vez. */
export const updateSlaPoliciesSchema = z
  .array(
    z
      .object({
        priority: z.enum(TICKET_PRIORITIES),
        firstResponseMinutes: minutes,
        resolutionMinutes: minutes,
      })
      .strict()
      .refine((policy) => policy.firstResponseMinutes <= policy.resolutionMinutes, {
        message: 'A meta da 1ª resposta não pode passar a da resolução.',
      }),
  )
  .refine(
    (policies) =>
      policies.length === TICKET_PRIORITIES.length &&
      TICKET_PRIORITIES.every((priority) => policies.some((p) => p.priority === priority)),
    { message: 'Informe a meta de cada prioridade, uma vez.' },
  );
export type UpdateSlaPoliciesInput = z.infer<typeof updateSlaPoliciesSchema>;

/** `PUT /api/admin/sla/hours`: substitui o horário inteiro. Intervalos do mesmo dia não se sobrepõem. */
export const updateBusinessHoursSchema = z
  .array(
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((interval) => interval.startMinute < interval.endMinute, {
        message: 'O fim do intervalo precisa ser depois do início.',
      }),
  )
  .min(1, 'Informe ao menos um intervalo de atendimento.')
  .max(21)
  .refine((intervals) => !hasOverlap(intervals), {
    message: 'Há intervalos sobrepostos no mesmo dia.',
  });
export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursSchema>;

function hasOverlap(intervals: readonly BusinessInterval[]): boolean {
  const sorted = intervals.toSorted(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  return sorted.some((interval, index) => {
    const previous = sorted[index - 1];
    return (
      previous !== undefined &&
      previous.weekday === interval.weekday &&
      previous.endMinute > interval.startMinute
    );
  });
}

const isCalendarDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

/** `POST /api/admin/holidays`. */
export const createHolidaySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
      .refine(isCalendarDate, 'Data inválida.'),
    name: z.string().trim().min(1, 'Informe o nome do feriado.').max(100),
  })
  .strict();
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

// ── Situação do SLA de um ticket ─────────────────────────────────────────────

export interface SlaTarget {
  /** Prazo (ISO), já somado o tempo pausado até a última retomada. */
  dueAt: string;
  /** Quando a meta foi cumprida: 1ª resposta, ou resolução (fechamento, se fechou sem resolver). */
  doneAt: string | null;
}

/** Só para agentes; o solicitante recebe `null`. */
export interface TicketSla {
  firstResponse: SlaTarget | null;
  resolution: SlaTarget | null;
  /** Início da pausa atual (pendente, resolvido, fechado). */
  pausedAt: string | null;
}

export type SlaState = 'met' | 'breached' | 'at_risk' | 'running' | 'paused';

/** Faltando isto ou menos para o prazo, a meta aparece como "vence logo". */
export const SLA_AT_RISK_MS = 2 * 60 * 60 * 1000;

/**
 * Situação de uma meta. O relógio para no início da pausa: cumprir a meta durante a pausa (ex.:
 * resolver um ticket pendente) conta como cumprida no momento em que ele parou.
 */
export function slaState(target: SlaTarget, pausedAt: string | null, now: Date): SlaState {
  const due = Date.parse(target.dueAt);
  const paused = pausedAt === null ? null : Date.parse(pausedAt);
  if (target.doneAt !== null) {
    const done = Date.parse(target.doneAt);
    const stopped = paused !== null && paused < done ? paused : done;
    return stopped <= due ? 'met' : 'breached';
  }
  if ((paused ?? now.getTime()) > due) return 'breached';
  if (paused !== null) return 'paused';
  return due - now.getTime() <= SLA_AT_RISK_MS ? 'at_risk' : 'running';
}
