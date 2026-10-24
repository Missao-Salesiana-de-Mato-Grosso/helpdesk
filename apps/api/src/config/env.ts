import { z } from 'zod';

// Variáveis de ambiente da API. Validadas uma vez na subida; a aplicação não inicia com valor inválido.
// Documentação dos valores em .env.example na raiz do monorepo. Cada tarefa acrescenta as suas aqui.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z
    .string()
    .startsWith('postgresql://', 'DATABASE_URL precisa começar com postgresql://'),

  // Zitadel (spec T04–T05)
  ZITADEL_ISSUER: z.url().transform((url) => url.replace(/\/+$/, '')),
  ZITADEL_PROJECT_ID: z
    .string()
    .min(1, 'ZITADEL_PROJECT_ID é obrigatório (id do projeto no Zitadel)'),
  /** Vazio = não verifica a organização do usuário (RN-06). */
  ZITADEL_ORG_ID: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  AUTH_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  AUTH_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),
});

export type Env = z.infer<typeof envSchema>;

/** Usada pelo ConfigModule. Lança um erro legível listando cada variável inválida. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${problems}`);
  }
  return result.data;
}
