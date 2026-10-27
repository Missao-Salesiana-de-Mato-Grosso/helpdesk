Closes #

## O que muda

## Como foi testado

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm format:check` passando
- [ ] Rota nova? Teste na matriz de permissões (`apps/api/test/authorization.e2e-spec.ts`)
- [ ] Migração nova? SQL revisado (migrações aplicadas não se editam)
- [ ] Passo de ambiente? Registrado em `docs/ambientes.md`

## Deploy

O merge na `main` dispara o deploy, que espera aprovação no ambiente `production`.
