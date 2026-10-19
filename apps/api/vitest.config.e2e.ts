import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/setup/test-database.js';

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
    },
  },
});
