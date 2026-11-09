import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessCalendar,
} from './business-time.js';

// Seg–sex, 7h–11h e 13h–17h em Cuiabá (UTC−4, sem horário de verão). 09/11/2026 é segunda;
// 20/11/2026 (sexta) é feriado.
const calendar: BusinessCalendar = {
  timeZone: 'America/Cuiaba',
  intervals: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 7 * 60, endMinute: 11 * 60 },
    { weekday, startMinute: 13 * 60, endMinute: 17 * 60 },
  ]),
  holidays: new Set(['2026-11-20']),
};

/** Hora local de Cuiabá → instante. */
const local = (date: string, time: string) => new Date(`${date}T${time}:00-04:00`);

describe('addBusinessMinutes', () => {
  it.each([
    ['dentro do intervalo', local('2026-11-09', '08:00'), 60, local('2026-11-09', '09:00')],
    ['atravessa o almoço', local('2026-11-09', '10:30'), 60, local('2026-11-09', '13:30')],
    ['atravessa o fim de semana', local('2026-11-13', '16:00'), 120, local('2026-11-16', '08:00')],
    ['começa no sábado', local('2026-11-14', '10:00'), 30, local('2026-11-16', '07:30')],
    ['pula o feriado', local('2026-11-19', '16:00'), 120, local('2026-11-23', '08:00')],
    ['1 dia útil termina às 17h', local('2026-11-09', '07:00'), 480, local('2026-11-09', '17:00')],
    ['começa de madrugada', local('2026-11-10', '03:00'), 60, local('2026-11-10', '08:00')],
  ])('%s', (_name, start, minutes, expected) => {
    expect(addBusinessMinutes(start, minutes, calendar)).toEqual(expected);
  });

  it('sem nenhum dia útil, falha em vez de girar para sempre', () => {
    expect(() =>
      addBusinessMinutes(local('2026-11-09', '08:00'), 60, { ...calendar, intervals: [] }),
    ).toThrow('Calendário sem horário útil');
  });
});

describe('businessMinutesBetween', () => {
  it.each([
    ['um dia útil inteiro', local('2026-11-09', '08:00'), local('2026-11-10', '08:00'), 480],
    ['fim de semana não conta', local('2026-11-13', '16:00'), local('2026-11-16', '08:00'), 120],
    ['feriado não conta', local('2026-11-19', '16:00'), local('2026-11-23', '08:00'), 120],
    ['fora do horário', local('2026-11-09', '11:15'), local('2026-11-09', '12:45'), 0],
    ['fim antes do início', local('2026-11-10', '08:00'), local('2026-11-09', '08:00'), 0],
  ])('%s', (_name, start, end, expected) => {
    expect(businessMinutesBetween(start, end, calendar)).toBe(expected);
  });

  it('é o inverso de addBusinessMinutes', () => {
    const start = local('2026-11-12', '09:41');
    for (const minutes of [1, 59, 240, 481, 2400]) {
      const end = addBusinessMinutes(start, minutes, calendar);
      expect(businessMinutesBetween(start, end, calendar)).toBe(minutes);
    }
  });
});
