import { z } from 'zod';
import type { NamedRef } from './me.js';

// T25: cadastros de referência mantidos pelo admin (unidades, departamentos, grupos e categorias).
// Não existe excluir: item desativado sai das listas de escolha, mas continua nos tickets e
// usuários que já o usam.

/** Categoria em que entram os tickets abertos por e-mail (T21). Não se renomeia nem desativa. */
export const DEFAULT_CATEGORY_NAME = 'Geral';

const name = z.string().trim().min(1, 'Informe o nome.').max(100);
const anyField = (data: Record<string, unknown>) =>
  Object.values(data).some((value) => value !== undefined);
const anyFieldMessage = { message: 'Informe ao menos um campo.' };

/** Unidade ou departamento na tela de admin (inclui os inativos). */
export interface CatalogItem {
  id: string;
  name: string;
  active: boolean;
}

export interface GroupItem extends CatalogItem {
  /** Recebe o aviso de ticket novo na fila, além dos membros (T14). */
  email: string | null;
}

export interface CategoryItem extends CatalogItem {
  defaultGroup: NamedRef & { active: boolean };
  /** A categoria padrão do canal de e-mail: nome e situação não mudam. */
  locked: boolean;
}

/** `POST /api/admin/companies` e `/api/admin/departments`. */
export const createCatalogItemSchema = z.object({ name }).strict();
export type CreateCatalogItemInput = z.infer<typeof createCatalogItemSchema>;

/** `PATCH /api/admin/companies/:id` e `/api/admin/departments/:id`. */
export const updateCatalogItemSchema = z
  .object({ name: name.optional(), active: z.boolean().optional() })
  .strict()
  .refine(anyField, anyFieldMessage);
export type UpdateCatalogItemInput = z.infer<typeof updateCatalogItemSchema>;

/** Vazio vira `null` (sem e-mail de aviso). */
const groupEmail = z
  .union([z.literal(''), z.email().max(254)])
  .nullable()
  .transform((value) => value || null);

/** `POST /api/admin/groups`. */
export const createGroupSchema = z.object({ name, email: groupEmail.optional() }).strict();
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/** `PATCH /api/admin/groups/:id`. */
export const updateGroupSchema = z
  .object({ name: name.optional(), email: groupEmail.optional(), active: z.boolean().optional() })
  .strict()
  .refine(anyField, anyFieldMessage);
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/** `POST /api/admin/categories`. */
export const createCategorySchema = z.object({ name, defaultGroupId: z.uuid() }).strict();
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** `PATCH /api/admin/categories/:id`. */
export const updateCategorySchema = z
  .object({
    name: name.optional(),
    defaultGroupId: z.uuid().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(anyField, anyFieldMessage);
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
