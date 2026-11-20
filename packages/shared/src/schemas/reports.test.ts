// Spec docs/specs/T37-relatorios.md — filtros do relatório.
import { describe, expect, it } from 'vitest';
import { reportDays, reportQuerySchema, satisfactionReportQuerySchema } from './reports.js';

const parse = (query: object) => reportQuerySchema.safeParse(query).success;

describe('reportQuerySchema (T37)', () => {
  it('CT-01 aceita datas válidas e grupo opcional', () => {
    expect(parse({ from: '2026-11-01', to: '2026-11-30' })).toBe(true);
    expect(parse({ from: '2026-11-20', to: '2026-11-20' })).toBe(true);
    expect(
      parse({
        from: '2026-11-01',
        to: '2026-11-30',
        groupId: '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d',
      }),
    ).toBe(true);
  });

  it('CT-01 recusa período invertido, acima de 366 dias, formato e data inexistente', () => {
    expect(parse({ from: '2026-11-30', to: '2026-11-01' })).toBe(false);
    expect(parse({ from: '2025-01-01', to: '2026-01-02' })).toBe(false);
    expect(parse({ from: '2025-01-01', to: '2026-01-01' })).toBe(true);
    expect(parse({ from: '01/11/2026', to: '2026-11-30' })).toBe(false);
    expect(parse({ from: '2026-02-30', to: '2026-03-01' })).toBe(false);
    expect(parse({ from: '2026-11-01', to: '2026-11-30', groupId: 'x' })).toBe(false);
    expect(parse({ from: '2026-11-01', to: '2026-11-30', extra: 1 })).toBe(false);
  });

  it('conta as duas pontas', () => {
    expect(reportDays('2026-11-01', '2026-11-30')).toBe(30);
    expect(reportDays('2026-11-20', '2026-11-20')).toBe(1);
  });
});

const parseCsat = (query: object) => satisfactionReportQuerySchema.safeParse(query);

describe('satisfactionReportQuerySchema (T40)', () => {
  it('CT-17 mesmos filtros do relatório e `low` opcional', () => {
    expect(parseCsat({ from: '2026-11-01', to: '2026-11-30' }).data?.low).toBe(false);
    expect(parseCsat({ from: '2026-11-01', to: '2026-11-30', low: 'true' }).data?.low).toBe(true);
    expect(parseCsat({ from: '2026-11-01', to: '2026-11-30', low: 'sim' }).success).toBe(false);
    expect(parseCsat({ from: '2026-11-30', to: '2026-11-01' }).success).toBe(false);
    expect(parseCsat({ from: '2025-01-01', to: '2026-01-02' }).success).toBe(false);
  });
});
