import { z } from 'zod';

// Variáveis de ambiente da API. Validadas uma vez na subida; a aplicação não inicia com valor inválido.
// Documentação dos valores em .env.example na raiz do monorepo. Cada tarefa acrescenta as suas aqui.
const optionalText = z
  .string()
  .optional()
  .transform((value) => value || undefined);

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

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

    // E-mail de saída (T14). Dev: Mailpit; produção: smtp.gmail.com:587 com senha de app.
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    /** `true` só para TLS direto (465). Na 587 o STARTTLS é negociado com `false`. */
    SMTP_SECURE: flag('false'),
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    MAIL_FROM: z.string().min(3).default('Suporte MSMT <suporte@missaosalesiana.org.br>'),
    PORTAL_URL: z
      .url()
      .default('http://localhost:5173')
      .transform((url) => url.replace(/\/+$/, '')),
    MAIL_MESSAGE_ID_DOMAIN: z.string().min(1).default('suporte.msmt.org.br'),
    NOTIFICATIONS_ENABLED: flag('true'),
    NOTIFICATIONS_BATCH_SIZE: z.coerce.number().int().positive().default(20),
    NOTIFICATIONS_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
    NOTIFICATIONS_MAX_ATTACHMENT_BYTES: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(20 * 1024 * 1024),
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
