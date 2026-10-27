# CI/CD

Pipeline em `.github/workflows/ci-cd.yml` (GitHub Actions), com dois jobs:

- **test** — em toda PR e push: build, lint, format check, typecheck e testes (`pnpm test`, inclui
  e2e contra o Postgres de serviço, no banco `helpdesk_test`). Não toca em produção.
- **deploy** — só em push na `main`, depois do `test` passar: faz o que `make deploy`
  (`deploy/prod/app.sh`) faz localmente, mas de forma não interativa (`ASSUME_YES=1`), publicando
  a imagem em `cr-msmt-prd` e implantando em `k8s-msmt-prd` (https://suporte.msmt.org.br).

O job `deploy` usa o ambiente do GitHub `production` — configure regras de proteção nele
(Settings → Environments → production → "Required reviewers") se quiser um aprovador humano antes
de cada deploy automático.

## Fluxo de mudança

1. **Issue** descrevendo a mudança (bug, tarefa do backlog, spec).
2. **Branch** a partir da `main`: `<tipo>/<n>-<resumo>` (ex.: `feat/12-admin-usuarios`, `fix/15-login-externo`).
3. **Pull Request** para a `main`, citando a issue (`Closes #12`). O template lista as verificações.
4. O job **test** roda no PR e precisa passar.
5. **Merge** na `main` → o job **deploy** fica aguardando aprovação no ambiente `production` → um revisor aprova → a imagem é publicada e implantada.

`make deploy` (local) continua existindo como contingência, por exemplo se o GitHub Actions estiver fora.

### Configuração no GitHub (uma vez, pelo dono do repositório)

- Settings → Environments → **production** → **Required reviewers**: quem aprova os deploys.
- Settings → Branches → regra para a `main`: **exigir Pull Request** antes do merge, **exigir o status check `test`** e bloquear push direto e force push.

## Segredos necessários (Settings → Secrets and variables → Actions)

| Secret                                                      | Origem                                                                                                       | Observação                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MGC_API_KEY`                                               | Console da Magalu Cloud → API Keys                                                                           | Autentica o `mgc` CLI sem login interativo. Escopo mínimo: Container Registry (ler credenciais) e Kubernetes (ler cluster/kubeconfig) na região `br-se1`. |
| `KUBECONFIG_PROD`                                           | `../msmt-infra-automation/secrets/kubeconfig-k8s-msmt-prd.yaml` (gerado por `make cluster` no repo de infra) | Cole o conteúdo do arquivo inteiro. Se o cluster for recriado, atualize este secret.                                                                      |
| `DB_HOST`                                                   | `../msmt-infra-automation/secrets/database.env` → `DB_HOST`                                                  |                                                                                                                                                           |
| `DB_HELPDESK_PASSWORD`                                      | idem → `DB_HELPDESK_PASSWORD`                                                                                |                                                                                                                                                           |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY`                           | `../msmt-infra-automation/secrets/object-storage.env`                                                        |                                                                                                                                                           |
| `SMTP_USER` / `SMTP_PASSWORD`                               | `secrets/helpdesk-email.env` local                                                                           | Opcional — vazio desliga notificações por e-mail.                                                                                                         |
| `MAILBOX_USER` / `MAILBOX_PASSWORD` / `MAILBOX_START_SINCE` | idem                                                                                                         | Opcional — vazio desliga a leitura da caixa de entrada.                                                                                                   |

Nenhum desses valores deve ser colado em chat, ticket ou log. O job monta os arquivos em
`secrets/` dentro de um diretório temporário do runner (nunca commitado) só para a duração do job,
reproduzindo o layout que `deploy/prod/lib.sh` espera do repositório irmão `msmt-infra-automation`.

### Por que o kubeconfig é um secret fixo, e não buscado a cada run

`deploy/prod/app.sh` já busca a credencial do Container Registry dinamicamente via
`mgc container-registry credentials get`, então a pipeline faz o mesmo. Já o kubeconfig do
cluster é salvo como secret (`KUBECONFIG_PROD`) em vez de buscado via `mgc kubernetes cluster
kubeconfig` a cada execução, para manter a action mais simples. Se preferir buscá-lo
dinamicamente (evitando esse secret de longa duração), ajuste o passo "Montar secrets/" para
rodar `mgc kubernetes cluster get-id` + `mgc kubernetes cluster kubeconfig` como faz
`../msmt-infra-automation/scripts/30-kubernetes.sh`.

## Situação em 27/10/2026

O conteúdo que faltava (código, testes, migrações, overlay de produção) foi restaurado ao juntar o
histórico completo do repositório local com o do GitHub. Ainda **não verificado** em execução real:
se o `mgc` autenticado por `MGC_API_KEY` consegue `container-registry credentials get` (a
credencial do registry é por usuário e por região; ver `docs/ambientes.md` §2.4).
