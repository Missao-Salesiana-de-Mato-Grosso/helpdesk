import { HttpStatus } from '@nestjs/common';
import { ApiErrorCode, type TicketStatus } from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';

/** RN-23: transições permitidas. `closed` é terminal. */
const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: [],
};

export const ticketClosed = () =>
  new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ApiErrorCode.TICKET_CLOSED,
    'Este ticket está fechado e não aceita alterações. Abra um novo chamado relacionado.',
  );

export const companyRequired = () =>
  new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ApiErrorCode.COMPANY_REQUIRED,
    'Defina a unidade do ticket antes de resolvê-lo ou fechá-lo.',
  );

export const versionConflict = (currentVersion: number) =>
  new ApiException(
    HttpStatus.CONFLICT,
    ApiErrorCode.VERSION_CONFLICT,
    'O ticket foi alterado por outra pessoa. Recarregue para ver a versão atual.',
    { currentVersion },
  );

export interface StatusChange {
  from: TicketStatus;
  to: TicketStatus;
  /** Campos de data que a transição grava (RN-25). */
  timestamps: { resolvedAt?: Date | null; closedAt?: Date };
}

/**
 * Valida a transição (RN-23) e a exigência de unidade (RN-24) e calcula as datas (RN-25).
 * Devolve `null` quando o status não muda.
 */
export function planStatusChange(
  from: TicketStatus,
  to: TicketStatus,
  companyId: string | null,
  now: Date,
): StatusChange | null {
  if (from === 'closed') throw ticketClosed();
  if (from === to) return null;
  if (!TRANSITIONS[from].includes(to)) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ApiErrorCode.INVALID_TRANSITION,
      `Não é possível mudar o status de "${from}" para "${to}".`,
    );
  }
  if ((to === 'resolved' || to === 'closed') && companyId === null) throw companyRequired();

  const timestamps: StatusChange['timestamps'] = {};
  if (to === 'resolved') timestamps.resolvedAt = now;
  if (from === 'resolved' && to === 'open') timestamps.resolvedAt = null;
  if (to === 'closed') timestamps.closedAt = now;
  return { from, to, timestamps };
}
