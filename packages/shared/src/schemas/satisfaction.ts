import { z } from 'zod';

// T40: pesquisa de satisfação (CSAT). O solicitante avalia pelo link do e-mail de resolvido.

/** RN-09: escala de 1 a 5. */
export const SATISFACTION_SCORES = [1, 2, 3, 4, 5] as const;
export type SatisfactionScore = (typeof SATISFACTION_SCORES)[number];

export const SATISFACTION_LABELS: Record<SatisfactionScore, string> = {
  1: 'Muito insatisfeito',
  2: 'Insatisfeito',
  3: 'Neutro',
  4: 'Satisfeito',
  5: 'Muito satisfeito',
};

/** RN-19: satisfeito = nota 4 ou 5. */
export const SATISFIED_MIN_SCORE = 4;
/** RN-21: nota baixa = 1 ou 2. */
export const LOW_MAX_SCORE = 2;
/** RN-10. */
export const MAX_SATISFACTION_COMMENT_LENGTH = 1000;

export function isSatisfactionScore(value: unknown): value is SatisfactionScore {
  return (SATISFACTION_SCORES as readonly unknown[]).includes(value);
}

/** Token do link (RN-14): 32 bytes em base64url = 43 caracteres. */
const token = z
  .string()
  .min(1, 'Link de avaliação ausente.')
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'Link de avaliação inválido.');

/** `POST /api/satisfaction/lookup` (RN-13). */
export const satisfactionLookupSchema = z.object({ token }).strict();
export type SatisfactionLookupInput = z.infer<typeof satisfactionLookupSchema>;

/** `PUT /api/satisfaction` (RN-09, RN-10). Comentário vazio vira `null`. */
export const satisfactionRateSchema = z
  .object({
    token,
    score: z
      .number()
      .int('A nota é um número inteiro de 1 a 5.')
      .min(1, 'A nota vai de 1 a 5.')
      .max(5, 'A nota vai de 1 a 5.'),
    comment: z
      .string()
      .trim()
      .max(
        MAX_SATISFACTION_COMMENT_LENGTH,
        `O comentário pode ter até ${MAX_SATISFACTION_COMMENT_LENGTH} caracteres.`,
      )
      .nullable()
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .strict();
export type SatisfactionRateInput = z.input<typeof satisfactionRateSchema>;
export type SatisfactionRateData = z.output<typeof satisfactionRateSchema>;

/** Resposta das duas rotas públicas (§5). */
export interface SatisfactionSurvey {
  ticketNumber: number;
  ticketSubject: string;
  score: SatisfactionScore | null;
  comment: string | null;
  ratedAt: string | null;
  expiresAt: string;
}

/** `TicketDetail.satisfaction`, só para supervisor e admin (RN-16, RN-17). */
export interface TicketSatisfaction {
  score: SatisfactionScore | null;
  comment: string | null;
  ratedAt: string | null;
  requestedAt: string;
  /** O link atual ainda aceita avaliação. */
  linkActive: boolean;
}
