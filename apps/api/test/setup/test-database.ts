// Banco de testes: um database separado no mesmo PostgreSQL do docker-compose (pnpm infra:up).
// Mais simples e mais rápido que subir um contêiner por execução; o custo é precisar da infra local no ar.
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://helpdesk:helpdesk@127.0.0.1:5434/helpdesk_test?schema=public';
