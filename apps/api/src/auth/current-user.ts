import type { AccessStatus, Role } from '@helpdesk/shared';
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
  /** Liberação de acesso ao portal (T22). Já reflete a auto-aprovação por role desta mesma requisição. */
  accessStatus: AccessStatus;
}

export interface AuthenticatedRequest extends Request {
  user?: CurrentUser;
}
