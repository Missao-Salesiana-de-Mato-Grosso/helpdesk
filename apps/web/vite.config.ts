import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // O .env fica na raiz do monorepo e é compartilhado com a API e o Docker Compose.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: {
    port: 5173,
    proxy: {
      // Em dev, a API roda em :3000. Em produção, o Nest serve o build e não há proxy.
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
