import type { TicketEvent } from '@helpdesk/shared';
import { describe, expect, it } from 'vitest';
import { eventText } from './event-text.ts';

const event = (type: string, data: Record<string, unknown> = {}): TicketEvent => ({
  id: '1',
  type,
  actor: { id: 'a1', name: 'João' },
  data,
  createdAt: '2026-10-24T12:00:00.000Z',
});

const refs = { u1: 'Ana', u2: 'Bruno', g1: 'Suporte TI', g2: 'Sistemas', c1: 'Colégio' };

describe('eventText', () => {
  it.each([
    [event('created'), 'abriu o chamado'],
    [
      event('status_changed', { from: 'open', to: 'pending' }),
      'mudou a situação de Aberto para Pendente',
    ],
    [
      event('status_changed', { from: 'resolved', to: 'open', reason: 'requester_reply' }),
      'reabriu o chamado ao responder',
    ],
    [
      event('priority_changed', { from: 'medium', to: 'urgent' }),
      'mudou a prioridade de Média para Urgente',
    ],
    [event('assigned', { from: null, to: 'u1' }), 'atribuiu a Ana'],
    [event('assigned', { from: 'u1', to: 'u2' }), 'trocou o responsável de Ana para Bruno'],
    [event('assigned', { from: 'u1', to: null }), 'removeu o responsável (Ana)'],
    [event('group_changed', { from: 'g1', to: 'g2' }), 'moveu do grupo Suporte TI para Sistemas'],
    [event('company_changed', { from: null, to: 'c1' }), 'definiu a unidade como Colégio'],
    [event('message_added', { kind: 'internal' }), 'adicionou uma nota interna'],
    [event('message_added', { kind: 'public' }), 'respondeu'],
    [event('assigned', { from: null, to: 'sumiu' }), 'atribuiu a item removido'],
  ])('%#: %s', (input, expected) => {
    expect(eventText(input, refs)).toBe(expected);
  });
});
