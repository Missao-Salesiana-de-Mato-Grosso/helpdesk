import type { TicketStatus } from '@helpdesk/shared';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  pending: 'Pendente',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

export const STATUS_COLOR: Record<TicketStatus, string> = {
  open: 'blue',
  pending: 'yellow',
  resolved: 'green',
  closed: 'gray',
};

// Mato Grosso: horário de Cuiabá, independente do fuso da máquina.
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Cuiaba',
});

export const formatDateTime = (iso: string): string => DATE_TIME.format(new Date(iso));
