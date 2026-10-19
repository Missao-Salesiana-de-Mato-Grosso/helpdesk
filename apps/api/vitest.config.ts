import { defineConfig } from 'vitest/config';

// Testes unitários: *.spec.ts ao lado do código.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
