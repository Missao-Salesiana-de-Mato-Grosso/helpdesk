import { z } from 'zod';
import { ROLES, type AccessStatus, type NamedRef, type Role } from './me.js';

/** `GET /api/users` (T15): busca de usuários para administração. A lixeira (T22) fica de fora. */
export const listUsersQuerySchema = z
  .object({
    /** Parte do nome ou do e-mail, sem diferenciar maiúsculas. */
    q: z.string().trim().max(100).optional(),
    /** `agent`: só quem tem papel de atendimento (agente, supervisor ou admin). */
    role: z.enum(['agent']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  /** Papéis efetivos: os do Zitadel somados aos concedidos no app (ADR-012). */
  roles: Role[];
  /** Vindos do Zitadel (no último login). Não se retiram pelo app. */
  zitadelRoles: Role[];
  /** Concedidos pela tela de usuários (T24). */
  appRoles: Role[];
  company: NamedRef | null;
  department: NamedRef | null;
  /** Grupos ativos de que é membro. */
  groups: NamedRef[];
  isExternal: boolean;
  active: boolean;
  accessStatus: AccessStatus;
  /** Nulo para quem nunca fez login (criado pelo canal de e-mail). */
  lastLoginAt: string | null;
}

export interface UserListResponse {
  items: UserSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * `PATCH /api/users/:id` (T15, T24). Só os campos enviados mudam. `appRoles` é a lista completa dos
 * papéis concedidos no app (substitui a atual); os do Zitadel não se editam aqui.
 */
export const updateUserSchema = z
  .object({
    companyId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    isExternal: z.boolean().optional(),
    active: z.boolean().optional(),
    appRoles: z
      .array(z.enum(ROLES))
      .max(ROLES.length)
      .transform((roles) => ROLES.filter((role) => roles.includes(role)))
      .optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo.',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** `PUT /api/groups/:id/members` (T15): a lista completa de membros, que substitui a atual. */
export const replaceGroupMembersSchema = z
  .object({
    userIds: z.array(z.uuid()).max(200),
  })
  .strict();

export type ReplaceGroupMembersInput = z.infer<typeof replaceGroupMembersSchema>;
