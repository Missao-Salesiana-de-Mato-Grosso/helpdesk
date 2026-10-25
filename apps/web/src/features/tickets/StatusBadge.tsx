import { Badge } from '@mantine/core';
import type { TicketStatus } from '@helpdesk/shared';
import { STATUS_COLOR, STATUS_LABEL } from './format.ts';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge color={STATUS_COLOR[status]} variant="light">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
