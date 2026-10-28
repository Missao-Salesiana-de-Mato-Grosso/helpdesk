import { z } from 'zod';

/** Roles do projeto no Zitadel. Sem nenhuma = solicitante. */
export const ROLES = ['admin', 'supervisor', 'agente'] as const;
export type Role = (typeof ROLES)[number];

/** Corpo de `PATCH /api/me` (tela de 1º acesso). Nenhum outro campo é aceito. */
export const updateMeSchema = z
  .object({
    companyId: z.uuid(),
    departmentId: z.uuid(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export interface NamedRef {
  id: string;
  name: string;
}

/** Liberação de acesso ao portal (T22, ADR-011). Independente de `active`. */
export const ACCESS_STATUSES = ['pending', 'approved', 'rejected', 'trashed'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/** Resposta de `GET /api/me` e `PATCH /api/me`. */
export interface MeResponse {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  isAgent: boolean;
  company: NamedRef | null;
  department: NamedRef | null;
  groups: NamedRef[];
  needsOnboarding: boolean;
  accessStatus: AccessStatus;
}
