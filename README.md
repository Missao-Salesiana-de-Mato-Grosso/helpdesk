# Help Desk MSMT

Help desk interno da Missão Salesiana de Mato Grosso. Substitui o Freshdesk.

- Discovery, escopo e decisões: [`docs/discovery/`](docs/discovery/README.md)
- Specs por tarefa: [`docs/specs/`](docs/specs/README.md)
- Instruções para o Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Estrutura

```
apps/api         NestJS 12 (ESM) — API, serve o build do front em produção
apps/web         React 19 + Vite 8 — SPA
packages/shared  Schemas zod, enums e tipos compartilhados
```

## Requisitos

- Node 24 LTS (`nvm use` lê o `.nvmrc`)
- pnpm 11
- Docker (para PostgreSQL, Zitadel e Mailpit locais, a partir da T02)

## Comandos

```bash
pnpm install
pnpm build        # compila shared, api e web (nesta ordem)
pnpm dev          # shared em watch + api em watch (:3000) + web (:5173, proxy /api)
pnpm test         # vitest em todos os pacotes
pnpm typecheck    # tsc --noEmit em todos os pacotes
pnpm lint         # oxlint (type-aware)
pnpm format       # prettier
```

Depois de clonar, rode `pnpm build` uma vez: a API e o front consomem o `dist/` do `packages/shared`.
