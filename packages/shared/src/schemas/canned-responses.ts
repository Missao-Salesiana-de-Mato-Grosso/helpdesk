import { z } from 'zod';
import { MAX_BODY_HTML_LENGTH } from './tickets.js';

// T26: respostas prontas. Agentes usam; admin e supervisor mantêm.

export interface CannedResponse {
  id: string;
  title: string;
  /** HTML já sanitizado; as variáveis (`{{solicitante}}`…) ficam como texto. */
  bodyHtml: string;
  updatedAt: string;
}

const title = z.string().trim().min(1, 'Informe o título.').max(100);
const bodyHtml = z
  .string()
  .max(MAX_BODY_HTML_LENGTH, 'O texto passa do limite de 100 KB')
  .min(1, 'Escreva o texto');

/** `POST /api/canned-responses`. */
export const createCannedResponseSchema = z.object({ title, bodyHtml }).strict();
export type CreateCannedResponseInput = z.infer<typeof createCannedResponseSchema>;

/** `PATCH /api/canned-responses/:id`. */
export const updateCannedResponseSchema = z
  .object({ title: title.optional(), bodyHtml: bodyHtml.optional() })
  .strict()
  .refine((data) => data.title !== undefined || data.bodyHtml !== undefined, {
    message: 'Informe ao menos um campo.',
  });
export type UpdateCannedResponseInput = z.infer<typeof updateCannedResponseSchema>;

/** Variáveis trocadas ao inserir a resposta no ticket (sempre como texto, nunca como HTML). */
export const CANNED_VARIABLES = {
  solicitante: 'Primeiro nome do solicitante',
  numero: 'Número do ticket (#1234)',
  agente: 'Seu primeiro nome',
} as const;

export type CannedVariables = Record<keyof typeof CANNED_VARIABLES, string>;

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Primeiro nome (o nome pode vir vazio para quem só escreveu por e-mail). */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/**
 * Troca `{{variavel}}` (com ou sem espaços dentro das chaves) pelo valor escapado. Variável
 * desconhecida fica como está, para o agente notar.
 */
export function fillCannedResponse(html: string, values: CannedVariables): string {
  const known = new Map<string, string>(Object.entries(values));
  return html.replaceAll(/\{\{\s*([a-z]+)\s*\}\}/g, (match, key: string) => {
    const value = known.get(key);
    return value === undefined ? match : escapeHtml(value);
  });
}
