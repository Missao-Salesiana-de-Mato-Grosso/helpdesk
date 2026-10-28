import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/setup/test-database.js';

export const E2E_STORAGE_PATH = join(tmpdir(), 'helpdesk-e2e-storage');
export const E2E_INBOX_PATH = join(tmpdir(), 'helpdesk-e2e-inbox');

// Testes e2e: test/**/*.e2e-spec.ts, sobem a aplicação Nest inteira contra o banco de testes.
// Exigem a infra local no ar (pnpm infra:up). Os arquivos rodam em série porque compartilham o banco.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    fileParallelism: false,
    globalSetup: ['./test/setup/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      LOG_LEVEL: 'warn',
      // T18: limite alto para as suítes; o teste de hardening troca as opções do throttler.
      THROTTLE_TTL_SECONDS: '60',
      THROTTLE_LIMIT: '100000',
      // test/setup/auth.ts assina tokens com este issuer e projeto; o Zitadel nunca é chamado.
      ZITADEL_ISSUER: 'http://zitadel.test',
      ZITADEL_PROJECT_ID: 'test-project',
      ZITADEL_ORG_ID: '',
      AUTH_CLOCK_TOLERANCE_SECONDS: '60',
      AUTH_CACHE_TTL_SECONDS: '60',
      // Anexos (T13) em disco, numa pasta temporária que a suíte de anexos limpa.
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_PATH: E2E_STORAGE_PATH,
      // Notificações (T14): o cron fica desligado; os testes chamam processOutbox() e o SMTP é o
      // Mailpit do docker-compose.
      NOTIFICATIONS_ENABLED: 'false',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      MAIL_FROM: 'Suporte MSMT <suporte@missaosalesiana.org.br>',
      PORTAL_URL: 'http://portal.test',
      MAIL_MESSAGE_ID_DOMAIN: 'helpdesk.test',
      // E-mail de entrada (T21): driver `folder` numa pasta temporária; os testes chamam pollMailbox().
      INBOUND_ENABLED: 'false',
      MAILBOX_DRIVER: 'folder',
      MAILBOX_FOLDER_PATH: E2E_INBOX_PATH,
      MAILBOX_START_SINCE: '',
      INTERNAL_EMAIL_DOMAINS: 'missaosalesiana.org.br',
      INBOUND_RATE_LIMIT_PER_HOUR: '20',
    },
  },
});
