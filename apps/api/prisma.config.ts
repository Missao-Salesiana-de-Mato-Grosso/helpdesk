// Configuração da CLI do Prisma (migrate, generate, db seed).
// A URL do banco vem de DATABASE_URL. O .env da raiz do monorepo é carregado se existir;
// uma variável já presente no ambiente (ex.: nos testes e em produção) tem precedência.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv, quiet: true });
}

// Sem DATABASE_URL (clone novo, build da imagem), `prisma generate` ainda precisa funcionar: o
// postinstall o executa. Um host inválido faz qualquer comando de banco falhar com erro claro.
const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://defina-DATABASE_URL-no-env:5432/helpdesk';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
