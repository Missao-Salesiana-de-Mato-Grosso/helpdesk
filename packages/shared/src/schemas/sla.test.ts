import { describe, expect, it } from 'vitest';
import {
  createHolidaySchema,
  slaState,
  updateBusinessHoursSchema,
  updateSlaPoliciesSchema,
} from './sla.js';

const policy = (priority: string, first = 60, resolution = 240) => ({
  priority,
  firstResponseMinutes: first,
  resolutionMinutes: resolution,
});

describe('updateSlaPoliciesSchema', () => {
  const all = ['low', 'medium', 'high', 'urgent'].map((p) => policy(p));

  it('aceita as quatro prioridades', () => {
    expect(updateSlaPoliciesSchema.safeParse(all).success).toBe(true);
  });

  it('recusa prioridade faltando ou repetida', () => {
    expect(updateSlaPoliciesSchema.safeParse(all.slice(1)).success).toBe(false);
    expect(updateSlaPoliciesSchema.safeParse([...all.slice(1), policy('high')]).success).toBe(
      false,
    );
  });

  it('recusa 1ª resposta maior que a resolução, e zero', () => {
    expect(
      updateSlaPoliciesSchema.safeParse([...all.slice(1), policy('low', 300, 240)]).success,
    ).toBe(false);
    expect(
      updateSlaPoliciesSchema.safeParse([...all.slice(1), policy('low', 0, 240)]).success,
    ).toBe(false);
  });
});

const interval = (weekday: number, startMinute: number, endMinute: number) => ({
  weekday,
  startMinute,
  endMinute,
});
const at = (iso: string) => new Date(iso);

describe('updateBusinessHoursSchema', () => {
  it('aceita manhã e tarde no mesmo dia', () => {
    const hours = [interval(1, 420, 660), interval(1, 780, 1020)];
    expect(updateBusinessHoursSchema.safeParse(hours).success).toBe(true);
  });

  it('recusa sobreposição, fim antes do início e lista vazia', () => {
    expect(
      updateBusinessHoursSchema.safeParse([interval(1, 420, 700), interval(1, 660, 1020)]).success,
    ).toBe(false);
    expect(updateBusinessHoursSchema.safeParse([interval(1, 660, 420)]).success).toBe(false);
    expect(updateBusinessHoursSchema.safeParse([]).success).toBe(false);
  });

  it('o mesmo horário em dias diferentes não é sobreposição', () => {
    const hours = [interval(1, 420, 660), interval(2, 420, 660)];
    expect(updateBusinessHoursSchema.safeParse(hours).success).toBe(true);
  });
});

describe('createHolidaySchema', () => {
  it('aceita data válida e recusa data inexistente', () => {
    expect(createHolidaySchema.safeParse({ date: '2026-12-25', name: 'Natal' }).success).toBe(true);
    expect(createHolidaySchema.safeParse({ date: '2026-02-30', name: 'X' }).success).toBe(false);
    expect(createHolidaySchema.safeParse({ date: '25/12/2026', name: 'X' }).success).toBe(false);
  });
});

describe('slaState', () => {
  const due = '2026-11-09T15:00:00.000Z';

  it('cumprida ou fora do prazo quando já foi feita', () => {
    expect(slaState({ dueAt: due, doneAt: '2026-11-09T14:00:00.000Z' }, null, at(due))).toBe('met');
    expect(slaState({ dueAt: due, doneAt: '2026-11-09T16:00:00.000Z' }, null, at(due))).toBe(
      'breached',
    );
  });

  it('feita durante a pausa conta do início da pausa', () => {
    const target = { dueAt: due, doneAt: '2026-11-12T12:00:00.000Z' };
    expect(slaState(target, '2026-11-09T14:00:00.000Z', at('2026-11-12T12:00:00.000Z'))).toBe(
      'met',
    );
  });

  it('correndo, vence logo e vencida', () => {
    const target = { dueAt: due, doneAt: null };
    expect(slaState(target, null, at('2026-11-09T10:00:00.000Z'))).toBe('running');
    expect(slaState(target, null, at('2026-11-09T13:30:00.000Z'))).toBe('at_risk');
    expect(slaState(target, null, at('2026-11-09T15:00:01.000Z'))).toBe('breached');
  });

  it('pausada antes do prazo fica pausada; pausada depois do prazo já venceu', () => {
    const target = { dueAt: due, doneAt: null };
    const later = at('2026-11-20T10:00:00.000Z');
    expect(slaState(target, '2026-11-09T14:00:00.000Z', later)).toBe('paused');
    expect(slaState(target, '2026-11-09T16:00:00.000Z', later)).toBe('breached');
  });
});
