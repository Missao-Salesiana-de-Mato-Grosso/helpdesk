import type { Role } from '@helpdesk/shared';
import type { Prisma } from '../generated/prisma/client.js';

/** O mínimo do usuário que define o escopo. `CurrentUser` satisfaz. */
export interface ScopeUser {
  id: string;
  roles: readonly Role[];
  groupIds: readonly string[];
}

export const seesAllTickets = (user: Pick<ScopeUser, 'roles'>): boolean =>
  user.roles.includes('supervisor') || user.roles.includes('admin');

export const isAgent = (user: Pick<ScopeUser, 'roles'>): boolean =>
  seesAllTickets(user) || user.roles.includes('agente');

/**
 * RN-01: quem vê quais tickets. Usada por TODA leitura e escrita do repositório de tickets.
 * - supervisor/admin: todos
 * - agente: os que solicitou, os atribuídos a ele e os dos seus grupos
 * - solicitante: só os que solicitou
 */
export function ticketScope(user: ScopeUser): Prisma.TicketWhereInput {
  if (seesAllTickets(user)) return {};
  if (user.roles.includes('agente')) {
    return {
      OR: [
        { requesterId: user.id },
        { assigneeId: user.id },
        { groupId: { in: [...user.groupIds] } },
      ],
    };
  }
  return { requesterId: user.id };
}
