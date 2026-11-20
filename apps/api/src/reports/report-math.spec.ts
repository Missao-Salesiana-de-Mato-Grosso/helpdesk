// Spec docs/specs/T37-relatorios.md — cálculos do relatório.
import type { BusinessCalendar } from '../sla/business-time.js';
import {
  buildSeries,
  reportMetrics,
  summarize,
  ticketDurations,
  type ReportTicket,
  type ReportWindow,
} from './report-math.js';

const TZ = 'America/Cuiaba';
/** Seg a sex, 08–12 e 13–17 (8 h úteis por dia). */
const calendar: BusinessCalendar = {
  timeZone: TZ,
  intervals: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 8 * 60, endMinute: 12 * 60 },
    { weekday, startMinute: 13 * 60, endMinute: 17 * 60 },
  ]),
  holidays: new Set(),
};

/** Hora local de Cuiabá (UTC−4, sem horário de verão). */
const at = (local: string) => new Date(`${local}:00-04:00`);

const ticket = (overrides: Partial<ReportTicket> = {}): ReportTicket => ({
  groupId: 'g1',
  assigneeId: null,
  companyId: null,
  categoryId: 'c1',
  source: 'portal',
  priority: 'medium',
  status: 'open',
  createdAt: at('2026-11-16T08:00'),
  firstResponseAt: null,
  resolvedAt: null,
  closedAt: null,
  firstResponseDueAt: null,
  resolutionDueAt: null,
  slaPausedMinutes: 0,
  ...overrides,
});

const window: ReportWindow = {
  start: at('2026-11-16T00:00'),
  end: at('2026-11-21T00:00'),
  now: at('2026-11-20T12:00'),
  calendar,
};

describe('relatórios — cálculos (T37)', () => {
  it('CT-02 mediana e média; lista vazia sem valor', () => {
    expect(summarize([30, 10, 20, 40])).toEqual({ median: 25, average: 25, count: 4 });
    expect(summarize([7, 1, 100])).toEqual({ median: 7, average: 36, count: 3 });
    expect(summarize([])).toEqual({ median: null, average: null, count: 0 });
  });

  it('CT-03 1ª resposta e resolução em horário útil, descontado o pendente', () => {
    const durations = ticketDurations(
      ticket({
        firstResponseAt: at('2026-11-16T10:00'),
        resolvedAt: at('2026-11-17T10:00'),
        slaPausedMinutes: 60,
      }),
      calendar,
    );
    expect(durations).toEqual({ firstResponse: 120, resolution: 540 });
    expect(ticketDurations(ticket({ resolvedAt: at('2026-11-16T09:00') }), null)).toEqual({
      firstResponse: null,
      resolution: null,
    });
  });

  it('CT-04 SLA da 1ª resposta: no prazo, fora, vencido sem resposta e sem meta', () => {
    const due = at('2026-11-17T08:00');
    const metrics = reportMetrics(
      [
        ticket({ firstResponseAt: at('2026-11-16T09:00'), firstResponseDueAt: due }),
        ticket({ firstResponseAt: at('2026-11-18T09:00'), firstResponseDueAt: due }),
        ticket({ firstResponseDueAt: due }),
        ticket({ firstResponseAt: at('2026-11-16T09:00') }),
        // Prazo dentro do período, mas ainda não venceu: não conta.
        ticket({ firstResponseDueAt: at('2026-11-20T16:00') }),
      ],
      window,
    );
    expect(metrics.firstResponseSla).toEqual({ met: 1, evaluated: 3 });
    expect(metrics.firstResponse.count).toBe(3);
  });

  it('resolução: fechado direto não conta em resolvidos; aberto com prazo vencido descumpre', () => {
    const metrics = reportMetrics(
      [
        ticket({ status: 'closed', closedAt: at('2026-11-17T09:00') }),
        ticket({ resolutionDueAt: at('2026-11-18T08:00') }),
        ticket({
          status: 'closed',
          closedAt: at('2026-11-18T09:00'),
          resolutionDueAt: at('2026-11-18T08:00'),
        }),
        ticket({ createdAt: at('2026-11-10T08:00') }),
      ],
      window,
    );
    expect(metrics).toMatchObject({ created: 3, resolved: 0, closed: 2 });
    expect(metrics.resolutionSla).toEqual({ met: 0, evaluated: 1 });
  });

  it('CT-05 evolução por dia até 62 dias e por semana acima disso', () => {
    const tickets = [
      ticket({ createdAt: at('2026-11-02T08:00') }),
      ticket({ createdAt: at('2026-11-03T23:30'), resolvedAt: at('2026-11-04T09:00') }),
    ];
    const daily = buildSeries(tickets, '2026-11-01', '2026-11-20', TZ);
    expect(daily.bucket).toBe('day');
    expect(daily.points).toHaveLength(20);
    expect(daily.points[2]).toEqual({ date: '2026-11-03', created: 1, resolved: 0 });
    expect(daily.points[3]).toEqual({ date: '2026-11-04', created: 0, resolved: 1 });

    const weekly = buildSeries(tickets, '2026-09-01', '2026-11-29', TZ);
    expect(weekly.bucket).toBe('week');
    expect(weekly.points[0]?.date).toBe('2026-08-31');
    const week = weekly.points.find((point) => point.date === '2026-11-02');
    expect(week).toEqual({ date: '2026-11-02', created: 2, resolved: 1 });
  });
});
