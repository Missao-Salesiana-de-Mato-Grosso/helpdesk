# Help Desk MSMT

Help desk interno da Missão Salesiana de Mato Grosso, que substitui o Freshdesk. Atende cerca de 20 agentes e 500 tickets/mês. A autenticação é feita pelo Zitadel self-hosted, federado com o Google Workspace (contas `@missaosalesiana.org.br`). **O canal principal é o e-mail:** mensagens para `suporte@missaosalesiana.org.br` viram tickets e as respostas por e-mail caem no mesmo ticket. O portal é o canal secundário.
Discovery, escopo e decisões: `docs/discovery/` (leia `README.md` e `adr/README.md` antes de mudanças estruturais).

## Stack

- **Node 24 LTS** (`.nvmrc`; rode `nvm use`), **pnpm 11**, **TypeScript 6.0** (não atualizar para o 7 sem pedido explícito)
- Monorepo **pnpm**: `apps/api` (NestJS), `apps/web` (React + Vite + TS), `packages/shared` (schemas zod, enums, `ApiErrorCode`)
- **Tudo é ESM** (`"type": "module"` nos três pacotes). Na API e no shared, imports relativos levam a extensão `.js` (`./health/health.module.js`), porque o TypeScript está em `module: nodenext`
- API: NestJS 12, Prisma (PostgreSQL), `jose` (JWT/JWKS), `@nestjs/schedule`, Nodemailer, `nestjs-pino`, `sanitize-html`
- Web: React 19, Vite 8, Mantine (+ `@mantine/tiptap`), TanStack Query, React Router, `react-oidc-context` / `oidc-client-ts`
- Ferramentas: **Vitest 4** (único runner, em todos os pacotes), **oxlint** (type-aware, config única em `.oxlintrc.json`), **Prettier**
- `packages/shared` é consumido pelo `dist/`: a API e o front precisam de `pnpm build` (ou `pnpm dev`, que compila em watch) depois de clonar
- Infra: Kubernetes (Magalu Cloud), Traefik, cert-manager, Kustomize (`deploy/k8s`), Helm para o Zitadel (`deploy/zitadel`)
- Zitadel **v4.19.5** (versão fixada; não atualizar sem pedido explícito)
- Produção: `https://suporte.msmt.org.br` (app) e `https://auth.msmt.org.br` (Zitadel). E-mail: caixa `suporte@missaosalesiana.org.br` no Gmail (IMAP para entrada via `imapflow` + `mailparser`, SMTP para saída via Nodemailer)

## Comandos

```bash
nvm use && pnpm install
pnpm build                           # shared → api → web (necessário uma vez após clonar)
cp .env.example .env                 # único .env: compose + API + front (Vite lê da raiz via envDir)
pnpm infra:up                        # postgres (127.0.0.1:5434, sempre pelo IP), zitadel (:8080, console em /ui/console), mailpit (:8025, SMTP :1025)
pnpm infra:reset                     # apaga volumes (Zitadel e bancos do zero)
pnpm dev                             # shared (tsc --watch) + api (:3000, nest --watch) + web (:5173, proxy /api → :3000)
pnpm test                            # vitest em todos os pacotes
pnpm --filter @helpdesk/api test:unit      # só *.spec.ts
pnpm --filter @helpdesk/api test:e2e       # só test/**/*.e2e-spec.ts (usa o banco helpdesk_test; exige a infra local)
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter @helpdesk/api prisma:migrate -- --name <nome>   # nova migração (dev)
pnpm --filter @helpdesk/api prisma:seed                      # dados de referência (idempotente)
```

Antes de dar uma tarefa como concluída, **sempre** rode `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm format:check`.

## Convenções

- Código, identificadores, commits e nomes de tabela em **inglês**. Textos de UI em **pt-BR**.
- TypeScript `strict`. Nada de `any` sem comentário justificando.
- DTOs e validação: schemas **zod** em `packages/shared`, reutilizados no front e no back (pipe de validação zod no Nest).
- Um módulo Nest por domínio (`tickets`, `users`, `groups`, `categories`, `companies`, `departments`, `attachments`, `notifications`, `inbound-email`, `auth`, `health`).
- `companies` são as unidades (escolas/obras; na UI, "Unidade") e `departments` os setores. `company_id` do ticket vem do solicitante e pode ser nulo quando o ticket chega por e-mail de alguém sem unidade; **resolver exige unidade**. Quem faz login precisa informar unidade e departamento antes de abrir ticket (tela de 1º acesso).
- Usuários com `is_external = true` (terceiros) nunca fazem login e só interagem por e-mail. Usuários sem `zitadel_sub` criados pelo canal de e-mail são vinculados pelo e-mail no 1º login. Um módulo não acessa as tabelas de outro diretamente: usa o service exportado.
- Prisma só dentro de services e repositories, nunca em controllers.
- Prisma 7: o client é **gerado em TypeScript** em `apps/api/src/generated/prisma` (gitignored; `prisma generate` roda no `postinstall` e antes de build, typecheck e test). Importe de `../generated/prisma/client.js`. Config da CLI em `apps/api/prisma.config.ts`; migrações em `apps/api/prisma/migrations`. Os enums do Prisma (`TicketStatus` etc.) são os enums de domínio.
- Migrações já aplicadas não se editam: crie uma nova com `prisma:migrate -- --name <nome>` e revise o SQL gerado antes de commitar.
- Enums de domínio: status `open | pending | resolved | closed`; prioridade `low | medium | high | urgent`; tipo de mensagem `public | internal`.

## Regras de segurança (inegociáveis)

- **Toda rota é autenticada por padrão** (guard global). Rotas públicas exigem `@Public()` explícito. Rotas de agente e admin exigem `@Roles(...)`.
- **O escopo de visibilidade é aplicado no repository de tickets**, nunca só no controller ou na UI:
  - solicitante: só os próprios tickets;
  - agente: os próprios, os dos seus grupos e os atribuídos a ele;
  - supervisor e admin: todos.
- Ticket fora do escopo → **404** (não 403), para não revelar a existência.
- Solicitante **nunca** recebe mensagens `internal`, nem por listagem, nem por include do Prisma.
- HTML do usuário é sanitizado no backend (`sanitize-html`, allowlist) **antes** de gravar.
- `PATCH` de ticket exige `version`. Versão desatualizada → 409.
- `ticket_events` é append-only: nunca gere UPDATE ou DELETE nessa tabela.
- E-mail de entrada: **idempotente por `Message-ID`** (`inbound_emails`), descarta auto-respostas (`Auto-Submitted`, `Precedence: bulk`, `X-Autoreply`) e e-mails da própria caixa, limita a 20 e-mails/h por remetente, e **nunca apaga** mensagens da caixa: só aplica rótulos.
- E-mail de saída: sempre pela outbox (`NotificationService.enqueue`), com `[#<número>]` no assunto, `Message-ID` próprio gravado em `email_message_refs` e `In-Reply-To`/`References` quando houver.
- **Nunca logue** corpo de mensagem, conteúdo de anexo, tokens ou o header `Authorization`.
- Segredos só via variáveis de ambiente / Kubernetes Secrets. Nunca commitar `.env`.
- Toda rota nova precisa de teste de autorização na suíte da matriz de permissões (`apps/api/test/authorization.e2e-spec.ts`).

## Autenticação (Zitadel)

- O login é federado com o Google Workspace, configurado no próprio Zitadel. O app **não lida com senhas, cadastro nem MFA**: só com tokens.
- Token de acesso é **JWT**, validado localmente via JWKS (`<ISSUER>/oauth/v2/keys`). Verificar `iss`, `aud` (contém `ZITADEL_PROJECT_ID`) e `exp`.
- Roles vêm do claim `urn:zitadel:iam:org:project:<ZITADEL_PROJECT_ID>:roles` (objeto; as roles são as **chaves**): `admin`, `supervisor`, `agente`. Sem role = solicitante.
- Usuário local é criado ou atualizado por JIT (`zitadel_sub`) em cada request autenticado, via cache curto. **Nome e e-mail vêm do endpoint `userinfo` do Zitadel**, não do access token. Usuário criado pelo canal de e-mail é vinculado pelo e-mail.
- Specs por tarefa em `docs/specs/`. Quando existir uma spec para a tarefa, ela manda; os CTs viram testes com o mesmo identificador no nome.
- Nos testes, **não dependa do Zitadel**: use o helper que assina tokens com chave RSA local e injeta um JWKS fake.

## Testes

- API: Vitest com `globals: true` (`describe`, `it`, `expect` sem import). Unitários junto ao código (`*.spec.ts`), e2e em `apps/api/test/*.e2e-spec.ts` com Supertest contra o banco `helpdesk_test` do docker-compose (exige `pnpm infra:up`); os arquivos rodam em série e usam `truncateAll()` de `test/setup/db.ts` no `beforeEach`.
- Web: Vitest + Testing Library + jsdom, arquivos `*.test.tsx` ao lado do componente, imports explícitos de `vitest`.
- Shared: Vitest, arquivos `*.test.ts`.
- E-mail: fixtures `.eml` em `apps/api/test/fixtures` processadas pelo driver `folder`. Os testes nunca tocam o Gmail.
- Toda tarefa do backlog (`docs/discovery/05-plano-mvp.md`) tem critério de aceite. Escreva o teste que o comprova.

## O que NÃO fazer

- Não adicionar dependências novas sem perguntar (principalmente infraestrutura: Redis, filas, motores de busca, WebSocket). O MVP é deliberadamente simples (ver ADRs).
- Não criar microsserviços, nem separar o front em outro deploy.
- Não editar migrações já aplicadas. Crie uma nova.
- Não desabilitar o guard, o ESLint ou testes para "fazer passar".
- Não enviar e-mail diretamente de um service nem chamar o IMAP fora do módulo `inbound-email`.
- Não executar `kubectl`, `helm` ou comandos contra produção. O deploy é feito pelo desenvolvedor via `make deploy`.
- Não alterar a versão do Zitadel, as configurações de token ou a estrutura de roles sem pedido explícito.
- Não implementar itens marcados como Fase 2 ou Fora em `docs/discovery/01-escopo.md`, salvo se pedido.
