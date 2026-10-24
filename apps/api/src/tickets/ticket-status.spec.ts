import { planStatusChange } from './ticket-status.js';

const now = new Date('2026-10-24T12:00:00Z');

describe('planStatusChange (RN-23 a RN-25)', () => {
  it('permite as transições da spec e calcula as datas', () => {
    expect(planStatusChange('open', 'resolved', 'u1', now)?.timestamps).toEqual({
      resolvedAt: now,
    });
    expect(planStatusChange('resolved', 'open', 'u1', now)?.timestamps).toEqual({
      resolvedAt: null,
    });
    expect(planStatusChange('pending', 'closed', 'u1', now)?.timestamps).toEqual({ closedAt: now });
    expect(planStatusChange('open', 'pending', null, now)?.timestamps).toEqual({});
  });

  it('mesmo status → null', () => {
    expect(planStatusChange('open', 'open', null, now)).toBeNull();
  });

  it('closed é terminal; resolved → pending é inválido', () => {
    expect(() => planStatusChange('closed', 'open', 'u1', now)).toThrow(
      expect.objectContaining({ code: 'TICKET_CLOSED' }),
    );
    expect(() => planStatusChange('resolved', 'pending', 'u1', now)).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('resolver ou fechar sem unidade → COMPANY_REQUIRED', () => {
    expect(() => planStatusChange('open', 'resolved', null, now)).toThrow(
      expect.objectContaining({ code: 'COMPANY_REQUIRED' }),
    );
    expect(() => planStatusChange('open', 'closed', null, now)).toThrow(
      expect.objectContaining({ code: 'COMPANY_REQUIRED' }),
    );
  });
});
