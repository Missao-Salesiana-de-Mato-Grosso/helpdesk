// Dados de exemplo dos testes de tickets (contrato de @helpdesk/shared).
import type {
  MeResponse,
  TicketDetail,
  TicketListResponse,
  TicketMessage,
  TicketSummary,
} from '@helpdesk/shared';

export const COMPANY = { id: '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d', name: 'Colégio Dom Bosco' };
export const OTHER_COMPANY = { id: '1c7a3b63-7a1f-4e8f-8b54-4d2e2b3c4d5e', name: 'Obra Social' };
export const CATEGORY = { id: '7b2f1d4c-3e5a-4c9b-9f3d-0e8a7b6c5d4e', name: 'Impressoras' };
export const TICKET_ID = '9c8b7a65-4d3e-4f2a-8b1c-0d9e8f7a6b5c';
export const OLD_ID = '2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d';

export const me: MeResponse = {
  id: 'u1',
  name: 'Maria Silva',
  email: 'maria@missaosalesiana.org.br',
  roles: [],
  isAgent: false,
  company: COMPANY,
  department: { id: 'd1', name: 'Secretaria' },
  groups: [],
  needsOnboarding: false,
};

export function message(overrides: Partial<TicketMessage> = {}): TicketMessage {
  return {
    id: 'm1',
    kind: 'public',
    via: 'portal',
    bodyHtml: '<p>A impressora não liga.</p>',
    quotedHtml: null,
    author: { id: 'u1', name: 'Maria Silva', isAgent: false },
    attachments: [],
    createdAt: '2026-10-24T12:00:00.000Z',
    ...overrides,
  };
}

export function detail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: TICKET_ID,
    number: 1001,
    subject: 'Impressora da secretaria',
    status: 'open',
    priority: 'medium',
    source: 'portal',
    version: 1,
    requester: {
      id: 'u1',
      name: 'Maria Silva',
      email: me.email,
      isExternal: false,
      company: COMPANY,
      department: null,
    },
    assignee: null,
    group: { id: 'g1', name: 'Suporte TI' },
    category: CATEGORY,
    company: COMPANY,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-10-24T12:00:00.000Z',
    updatedAt: '2026-10-24T12:00:00.000Z',
    messages: [message()],
    events: [],
    refs: {},
    ...overrides,
  };
}

export function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: TICKET_ID,
    number: 1001,
    subject: 'Impressora da secretaria',
    status: 'pending',
    priority: 'medium',
    requester: { id: 'u1', name: 'Maria Silva', isExternal: false },
    assignee: null,
    group: { id: 'g1', name: 'Suporte TI' },
    company: COMPANY,
    category: CATEGORY,
    createdAt: '2026-10-24T12:00:00.000Z',
    updatedAt: '2026-10-24T15:30:00.000Z',
    lastMessageAt: null,
    ...overrides,
  };
}

export const page = (items: TicketSummary[]): TicketListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});
