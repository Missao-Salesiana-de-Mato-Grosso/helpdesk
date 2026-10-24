import type { Role } from '@helpdesk/shared';
import type { Request } from 'express';

/** Quem está fazendo a requisição (RN-08). Controllers e services nunca leem o token diretamente. */
export interface CurrentUser {
  id: string;
  zitadelSub: string;
  email: string;
  name: string;
  roles: Role[];
  /** roles ∩ {agente, supervisor, admin} ≠ ∅ */
  isAgent: boolean;
  companyId: string | null;
  departmentId: string | null;
  groupIds: string[];
  needsOnboarding: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: CurrentUser;
}
