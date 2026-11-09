import type { BusinessInterval } from '@helpdesk/shared';

/** Ordem da tela: segunda a domingo (`weekday` 0 = domingo). */
export const WEEKDAYS = [
  { weekday: 1, label: 'Segunda' },
  { weekday: 2, label: 'Terça' },
  { weekday: 3, label: 'Quarta' },
  { weekday: 4, label: 'Quinta' },
  { weekday: 5, label: 'Sexta' },
  { weekday: 6, label: 'Sábado' },
  { weekday: 0, label: 'Domingo' },
] as const;

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Intervalos de um dia como texto: `07:00–11:00, 13:00–17:00`. Vazio = fechado. */
export function formatIntervals(intervals: readonly BusinessInterval[], weekday: number): string {
  return intervals
    .filter((interval) => interval.weekday === weekday)
    .toSorted((a, b) => a.startMinute - b.startMinute)
    .map((interval) => `${clock(interval.startMinute)}–${clock(interval.endMinute)}`)
    .join(', ');
}

const RANGE = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/;

/** Lê o texto de um dia. `24:00` vale como fim do dia. Erro em pt-BR para mostrar no campo. */
export function parseIntervals(
  text: string,
  weekday: number,
): { intervals: BusinessInterval[] } | { error: string } {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const intervals: BusinessInterval[] = [];
  for (const part of parts) {
    const match = RANGE.exec(part);
    if (!match) return { error: `Use o formato 07:00–11:00 (em "${part}").` };
    const group = (index: number) => Number(match[index]);
    const [startMin, endMin] = [group(2), group(4)];
    const startMinute = group(1) * 60 + startMin;
    const endMinute = group(3) * 60 + endMin;
    if (startMin > 59 || endMin > 59 || startMinute > 1439 || endMinute > 1440) {
      return { error: `Horário inválido em "${part}".` };
    }
    if (startMinute >= endMinute)
      return { error: `O fim precisa ser depois do início em "${part}".` };
    intervals.push({ weekday, startMinute, endMinute });
  }
  const sorted = intervals.toSorted((a, b) => a.startMinute - b.startMinute);
  if (
    sorted.some(
      (interval, index) => index > 0 && sorted[index - 1]!.endMinute > interval.startMinute,
    )
  ) {
    return { error: 'Há intervalos sobrepostos.' };
  }
  return { intervals: sorted };
}
