// Spec T35: o que a fila mostra depois de uma ação em lote (RN-21, RN-22).
import type {
  BulkUpdateFailure,
  BulkUpdateTicketsInput,
  BulkUpdateTicketsResponse,
  TicketSummary,
} from '@helpdesk/shared';
import { STATUS_LABEL } from '../tickets/format.ts';

export type BulkChanges = BulkUpdateTicketsInput['changes'];

/** O que a fila mostra depois de aplicar (RN-21). */
export interface BulkOutcome {
  succeeded: number;
  failures: string[];
}

/** RN-22: motivo da falha em pt-BR, pelo código; outro código usa a mensagem da API. */
export function failureLine(
  failure: BulkUpdateFailure,
  ticket: TicketSummary | undefined,
  changes: BulkChanges,
): string {
  if (failure.code === 'NOT_FOUND' || failure.number === undefined) {
    return 'Chamado não encontrado ou fora do seu acesso';
  }
  const reason = (() => {
    switch (failure.code) {
      case 'VERSION_CONFLICT':
        return 'alterado por outra pessoa; confira e tente de novo';
      case 'TICKET_CLOSED':
        return 'já está fechado';
      case 'INVALID_TRANSITION':
        return ticket && changes.status
          ? `não pode ir de ${STATUS_LABEL[ticket.status]} para ${STATUS_LABEL[changes.status]}`
          : failure.message;
      case 'COMPANY_REQUIRED':
        return 'sem unidade; defina a unidade para resolver ou fechar';
      case 'ASSIGNEE_NOT_IN_GROUP':
        return 'o responsável não é do grupo do chamado';
      default:
        return failure.message;
    }
  })();
  return `#${failure.number} — ${reason}`;
}

export function toOutcome(
  response: BulkUpdateTicketsResponse,
  tickets: TicketSummary[],
  changes: BulkChanges,
): BulkOutcome {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return {
    succeeded: response.succeeded,
    failures: response.results.flatMap((result) =>
      result.ok ? [] : [failureLine(result, byId.get(result.id), changes)],
    ),
  };
}
