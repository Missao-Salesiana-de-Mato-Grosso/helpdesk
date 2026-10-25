# T17 — Deploy de produção (app e Zitadel)

**Status:** implementada (2026-10-25). Passo a passo de execução: `docs/ambientes.md` §2.4.

## Escopo

- Imagem única (`Dockerfile`, multi-stage, `linux/amd64`): a API NestJS serve o build do front (`WEB_DIST_PATH`), sem segundo deploy (CLAUDE.md). Mantém as dependências de desenvolvimento para o Job de migração (CLI do Prisma, `tsx` no seed).
- `apps/api/src/common/spa.ts`: `/assets/*` com cache imutável; demais GET fora de `/api` → `index.html` sem cache.
- Kustomize `deploy/k8s` (`base` + `overlays/prod`): Deployment (1 réplica, `Recreate`, sistema de arquivos só leitura, probes em `/api/health`), Service, Ingress Traefik com cert-manager (`letsencrypt-prod`), ConfigMap não secreto e Job de migração.
- Zitadel v4.19.5 pelo chart oficial 10.4.0 (`deploy/zitadel/values.yaml`), Login V2, banco `zitadel` no DBaaS (o init só cria as tabelas).
- `deploy/local/zitadel-bootstrap.mjs` com modo produção (`BOOTSTRAP_TARGET=prod`).
- `Makefile`: `zitadel`, `zitadel-bootstrap`, `deploy`, `status`. Executados pelo desenvolvedor; o Claude Code não roda `kubectl`/`helm` contra produção.

## Critérios de aceite (05-plano-mvp.md)

| Critério                                                     | Como se comprova                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `make deploy` publica                                        | Saída do `make deploy` (`Deploy de … concluído`)                                                                        |
| `/api/health` = 200 em `suporte.msmt.org.br`                 | Verificação no fim do `make deploy` e `make status`                                                                     |
| O front é servido pela API, com rotas do SPA e cache correto | `spa.spec.ts` (8 testes) e teste local da imagem com sistema de arquivos só leitura (health, `/`, `/tickets/1`, assets) |
| Cron de e-mail roda em produção contra `suporte-teste@`      | Depende de `helpdesk-email.env` (etapa 1 do rollout); ver 2.3                                                           |

## Decisões

1. **Segredos** ficam em `msmt-infra-automation/secrets/` (um só lugar, fora do git) e viram Secrets do Kubernetes no deploy, sempre pela entrada padrão (nunca na linha de comando).
2. **E-mail opcional** no 1º deploy: sem credenciais, o app sobe com notificações e IMAP desligados, para o login e o portal poderem ser homologados antes.
3. **Sem `@nestjs/serve-static`** (dependência nova): `useStaticAssets` do próprio `NestExpressApplication`.
4. **Admin de emergência** do Zitadel com e-mail fora do Workspace, para não colidir com a conta Google ao ativar o IdP.
