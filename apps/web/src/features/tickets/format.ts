import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type TicketPriority,
  type TicketStatus,
} from '@helpdesk/shared';

export const STATUS_LABEL = TICKET_STATUS_LABELS;

export const STATUS_COLOR: Record<TicketStatus, string> = {
  open: 'blue',
  pending: 'yellow',
  resolved: 'green',
  closed: 'gray',
};

export const PRIORITY_LABEL = TICKET_PRIORITY_LABELS;

export const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: 'gray',
  medium: 'blue',
  high: 'orange',
  urgent: 'red',
};

// Mato Grosso: horário de Cuiabá, independente do fuso da máquina.
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Cuiaba',
});

export const formatDateTime = (iso: string): string => DATE_TIME.format(new Date(iso));
