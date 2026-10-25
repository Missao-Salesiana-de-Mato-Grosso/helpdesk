import { Text, Timeline } from '@mantine/core';
import type { TicketDetail } from '@helpdesk/shared';
import { formatDateTime } from '../tickets/format.ts';
import { eventText } from './event-text.ts';

/** Aba "Histórico" (T12): `ticket_events` em pt-BR, com os nomes de `refs`. */
export function TicketHistory({ ticket }: { ticket: TicketDetail }) {
  return (
    <Timeline bulletSize={12} lineWidth={2}>
      {ticket.events.map((event) => (
        <Timeline.Item key={event.id}>
          <Text size="sm">
            <Text span fw={600}>
              {event.actor.name}
            </Text>{' '}
            {eventText(event, ticket.refs)}
          </Text>
          <Text size="xs" c="dimmed">
            {formatDateTime(event.createdAt)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
