import { defineConfig } from 'vitest/config';

// Testes e2e: test/**/*.e2e-spec.ts, sobem a aplicação Nest inteira.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
  },
});
