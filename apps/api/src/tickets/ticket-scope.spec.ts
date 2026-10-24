import { ticketScope } from './ticket-scope.js';

describe('ticketScope (RN-01)', () => {
  it('CT-49 solicitante: só os próprios', () => {
    expect(ticketScope({ id: 'u1', roles: [], groupIds: ['g1'] })).toEqual({ requesterId: 'u1' });
  });

  it('CT-49 agente: solicitados, atribuídos e dos seus grupos', () => {
    expect(ticketScope({ id: 'u1', roles: ['agente'], groupIds: ['g1', 'g2'] })).toEqual({
      OR: [{ requesterId: 'u1' }, { assigneeId: 'u1' }, { groupId: { in: ['g1', 'g2'] } }],
    });
  });

  it('CT-49 agente sem grupos ainda vê os próprios e os atribuídos', () => {
    expect(ticketScope({ id: 'u1', roles: ['agente'], groupIds: [] })).toEqual({
      OR: [{ requesterId: 'u1' }, { assigneeId: 'u1' }, { groupId: { in: [] } }],
    });
  });

  it('CT-49 supervisor e admin: sem restrição (inclusive acumulando agente)', () => {
    expect(ticketScope({ id: 'u1', roles: ['supervisor'], groupIds: [] })).toEqual({});
    expect(ticketScope({ id: 'u1', roles: ['admin'], groupIds: [] })).toEqual({});
    expect(ticketScope({ id: 'u1', roles: ['agente', 'supervisor'], groupIds: ['g1'] })).toEqual(
      {},
    );
  });
});
