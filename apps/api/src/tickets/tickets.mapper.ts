import type { TicketDetail, TicketSummary } from '@helpdesk/shared';
import { isAgent } from './ticket-scope.js';
import type { TicketDetailRow, TicketSummaryRow } from './tickets.repository.js';

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export function toTicketSummary(row: TicketSummaryRow): TicketSummary {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    requester: row.requester,
    assignee: row.assignee,
    group: row.group,
    company: row.company,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: iso(row.messages[0]?.createdAt ?? null),
  };
}

export function toTicketDetail(
  row: TicketDetailRow,
  refs: Record<string, string> = {},
): TicketDetail {
  return {
    refs,
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    source: row.source,
    version: row.version,
    requester: row.requester,
    assignee: row.assignee,
    group: row.group,
    category: row.category,
    company: row.company,
    firstResponseAt: iso(row.firstResponseAt),
    resolvedAt: iso(row.resolvedAt),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      via: message.via,
      bodyHtml: message.bodyHtml,
      quotedHtml: message.quotedHtml,
      author: {
        id: message.author.id,
        name: message.author.name,
        isAgent: isAgent({ roles: message.author.roles.filter(isRole) }),
      },
      attachments: message.attachments,
      createdAt: message.createdAt.toISOString(),
    })),
    events: row.events.map((event) => ({
      id: event.id.toString(),
      type: event.type,
      actor: event.actor,
      data: jsonObject(event.data),
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

const KNOWN_ROLES = new Set(['admin', 'supervisor', 'agente']);
function isRole(value: string): value is 'admin' | 'supervisor' | 'agente' {
  return KNOWN_ROLES.has(value);
}
