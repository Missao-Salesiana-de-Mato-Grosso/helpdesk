import { TicketEventsRepository } from './tickets.repository.js';

describe('TicketEventsRepository', () => {
  it('CT-50 ticket_events é append-only: o repositório só expõe append', () => {
    expectTypeOf<keyof TicketEventsRepository>().toEqualTypeOf<'append'>();
    const methods = Object.getOwnPropertyNames(TicketEventsRepository.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods).toEqual(['append']);
  });
});
