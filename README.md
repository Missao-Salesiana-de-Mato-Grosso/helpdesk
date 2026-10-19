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
nvm use
pnpm install
cp .env.example .env   # um único .env para o compose, a API e o front
pnpm infra:up          # PostgreSQL, Zitadel (API + Login V2 via Traefik) e Mailpit
pnpm build             # compila shared, api e web (nesta ordem)
pnpm dev               # shared em watch + api em watch (:3000) + web (:5173, proxy /api)
pnpm test              # vitest em todos os pacotes
pnpm typecheck         # tsc --noEmit em todos os pacotes
pnpm lint              # oxlint (type-aware)
pnpm format            # prettier
pnpm infra:down        # para os contêineres (mantém os dados)
pnpm infra:reset       # apaga os volumes: Zitadel e bancos voltam do zero
```

Depois de clonar, rode `pnpm build` uma vez: a API e o front consomem o `dist/` do `packages/shared`.

## Ambiente local

| Serviço                    | Endereço                                                    | Credenciais                                       |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| Zitadel console            | http://localhost:8080/ui/console                            | `zitadel-admin@zitadel.localhost` / `Password1!`  |
| Zitadel OIDC               | http://localhost:8080 (`/.well-known/openid-configuration`) | —                                                 |
| Mailpit (e-mails enviados) | http://localhost:8025 · SMTP `localhost:1025`               | —                                                 |
| PostgreSQL                 | `127.0.0.1:5434`, bancos `helpdesk` e `zitadel`             | `helpdesk` / `helpdesk` · `postgres` / `postgres` |

Use `127.0.0.1`, não `localhost`, para o PostgreSQL: a porta é publicada só em IPv4 (5434, para não colidir com um Postgres instalado na máquina), e `localhost` pode resolver para `::1` e cair em outro servidor.

O Zitadel grava dois PATs em `./.local/zitadel/` (fora do git): `login-client.pat`, usado pelo contêiner do Login V2, e `admin.pat`, um service user com papel IAM_OWNER para scripts de bootstrap (criar projeto, aplicação e roles pela API).
