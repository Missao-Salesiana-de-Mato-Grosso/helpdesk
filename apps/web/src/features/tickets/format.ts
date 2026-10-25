import type { TicketPriority, TicketStatus } from '@helpdesk/shared';

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

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

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
