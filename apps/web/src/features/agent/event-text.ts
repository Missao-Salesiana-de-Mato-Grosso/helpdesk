import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
} from '@helpdesk/shared';
import { PRIORITY_LABEL, STATUS_LABEL } from '../tickets/format.ts';

const isStatus = (value: unknown): value is TicketStatus =>
  typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
const isPriority = (value: unknown): value is TicketPriority =>
  typeof value === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(value);

const status = (value: unknown) => (isStatus(value) ? STATUS_LABEL[value] : String(value));
const priority = (value: unknown) => (isPriority(value) ? PRIORITY_LABEL[value] : String(value));

/** Frase do histórico, sem o nome de quem agiu (ex.: "mudou a situação de Aberto para Pendente"). */
export function eventText(event: TicketEvent, refs: Record<string, string>): string {
  const { from, to } = event.data;
  const name = (id: unknown) =>
    typeof id === 'string' ? (refs[id] ?? 'item removido') : 'ninguém';

  switch (event.type) {
    case 'created':
      return event.data.relatedTicketId
        ? 'abriu o chamado (relacionado a um chamado anterior)'
        : 'abriu o chamado';
    case 'status_changed':
      return event.data.reason === 'requester_reply'
        ? 'reabriu o chamado ao responder'
        : `mudou a situação de ${status(from)} para ${status(to)}`;
    case 'priority_changed':
      return `mudou a prioridade de ${priority(from)} para ${priority(to)}`;
    case 'assigned':
      if (to === null || to === undefined) return `removeu o responsável (${name(from)})`;
      return from === null || from === undefined
        ? `atribuiu a ${name(to)}`
        : `trocou o responsável de ${name(from)} para ${name(to)}`;
    case 'group_changed':
      return `moveu do grupo ${name(from)} para ${name(to)}`;
    case 'category_changed':
      return `mudou a categoria de ${name(from)} para ${name(to)}`;
    case 'company_changed':
      return from === null || from === undefined
        ? `definiu a unidade como ${name(to)}`
        : `mudou a unidade de ${name(from)} para ${name(to)}`;
    case 'message_added':
      return event.data.kind === 'internal' ? 'adicionou uma nota interna' : 'respondeu';
    default:
      return event.type;
  }
}
