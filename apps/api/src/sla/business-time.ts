import type { BusinessInterval } from '@helpdesk/shared';

/** Horário útil: intervalos por dia da semana e feriados (`AAAA-MM-DD`), num fuso IANA. */
export interface BusinessCalendar {
  timeZone: string;
  intervals: readonly BusinessInterval[];
  holidays: ReadonlySet<string>;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Teto da busca por dia útil (10 anos): só dispara com um calendário sem nenhum dia útil. */
const MAX_DAYS = 3660;

/** Dia local (`AAAA-MM-DD`) e minuto do dia (com fração) de um instante, no fuso. */
interface LocalTime {
  date: string;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** Diferença (ms) entre a hora local no fuso e o UTC, no instante dado. */
function offsetAt(instant: number, timeZone: string): number {
  const values = new Map(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  );
  const part = (type: Intl.DateTimeFormatPartTypes) => values.get(type) ?? 0;
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function toLocal(instant: Date, timeZone: string): LocalTime {
  const local = instant.getTime() + offsetAt(instant.getTime(), timeZone);
  const midnight = Math.floor(local / DAY_MS) * DAY_MS;
  return {
    date: new Date(midnight).toISOString().slice(0, 10),
    minute: (local - midnight) / MINUTE_MS,
  };
}

/** Instante UTC do minuto `minute` do dia local `date`. Duas passadas acertam a troca de horário. */
function toUtc(date: string, minute: number, timeZone: string): Date {
  const local = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  let guess = local - offsetAt(local, timeZone);
  guess = local - offsetAt(guess, timeZone);
  // A fração de minuto pode deixar resto de ponto flutuante: arredonda para o ms.
  return new Date(Math.round(guess));
}

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** Intervalos úteis do dia local, em ordem; nenhum em feriado. */
function windows(calendar: BusinessCalendar, date: string): BusinessInterval[] {
  if (calendar.holidays.has(date)) return [];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return calendar.intervals
    .filter((interval) => interval.weekday === weekday)
    .toSorted((a, b) => a.startMinute - b.startMinute);
}

/**
 * Instante em que se completam `minutes` minutos úteis a partir de `start`. Começando fora do
 * horário, a contagem começa no próximo intervalo útil.
 */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  let remaining = minutes;
  let { date, minute } = toLocal(start, calendar.timeZone);
  for (let day = 0; day < MAX_DAYS; day++) {
    for (const interval of windows(calendar, date)) {
      const from = Math.max(interval.startMinute, minute);
      if (from >= interval.endMinute) continue;
      const available = interval.endMinute - from;
      if (remaining <= available) return toUtc(date, from + remaining, calendar.timeZone);
      remaining -= available;
    }
    date = nextDay(date);
    minute = 0;
  }
  throw new Error('Calendário sem horário útil');
}

/** Minutos úteis (inteiros) entre dois instantes; 0 se `end` não vem depois de `start`. */
export function businessMinutesBetween(start: Date, end: Date, calendar: BusinessCalendar): number {
  if (end <= start) return 0;
  const last = toLocal(end, calendar.timeZone);
  let { date, minute } = toLocal(start, calendar.timeZone);
  let total = 0;
  while (date <= last.date) {
    const limit = date === last.date ? last.minute : 24 * 60;
    for (const interval of windows(calendar, date)) {
      const overlap = Math.min(interval.endMinute, limit) - Math.max(interval.startMinute, minute);
      if (overlap > 0) total += overlap;
    }
    date = nextDay(date);
    minute = 0;
  }
  return Math.round(total);
}
