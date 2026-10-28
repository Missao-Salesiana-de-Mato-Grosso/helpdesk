import { z } from 'zod';
import type { AccessStatus, NamedRef } from './me.js';

/** `POST /api/users/:id/access/approve` (T22, RN-11). */
export const approveAccessSchema = z
  .object({
    companyId: z.uuid(),
    departmentId: z.uuid(),
    isExternal: z.boolean().optional(),
  })
  .strict();

export type ApproveAccessInput = z.infer<typeof approveAccessSchema>;

/** `POST /api/users/:id/access/reject` (T22, RN-12). Nota interna, nunca exposta ao usuário. */
export const rejectAccessSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type RejectAccessInput = z.infer<typeof rejectAccessSchema>;

/** `GET /api/users/access-requests` (T22, RN-10). */
export const listAccessRequestsQuerySchema = z
  .object({
    status: z.enum(['pending', 'trashed']).default('pending'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type ListAccessRequestsQuery = z.output<typeof listAccessRequestsQuerySchema>;

export interface AccessRequestSummary {
  id: string;
  name: string;
  email: string;
  /** Sugeridos pelo próprio usuário no 1º acesso; o admin confirma ou troca ao aprovar. */
  company: NamedRef | null;
  department: NamedRef | null;
  /** E-mail fora de `INTERNAL_EMAIL_DOMAINS` (RN-10). */
  isExternalDomain: boolean;
  accessStatus: AccessStatus;
  accessRequestedAt: string;
}

export interface AccessRequestListResponse {
  items: AccessRequestSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmptyTrashResponse {
  deleted: number;
  /** Pulados por já ter ticket (RN-19d): o item volta para `pending` em vez de ser excluído. */
  skipped: number;
}
