import { z } from 'zod';

// Variáveis de ambiente da API. Validadas uma vez na subida; a aplicação não inicia com valor inválido.
// Documentação dos valores em .env.example na raiz do monorepo. Cada tarefa acrescenta as suas aqui.
const optionalText = z
  .string()
  .optional()
  .transform((value) => value || undefined);

export const envSchema = z
  .object({
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

    // Anexos (T13). `local` em dev e testes; `s3` (Object Storage da Magalu) em produção.
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().min(1).default('./storage'),
    S3_ENDPOINT: optionalText.pipe(z.url().optional()),
    S3_REGION: z.string().min(1).default('br-se1'),
    S3_BUCKET: optionalText,
    S3_ACCESS_KEY: optionalText,
    S3_SECRET_KEY: optionalText,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== 's3') return;
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} é obrigatório com STORAGE_DRIVER=s3`,
        });
    }
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
