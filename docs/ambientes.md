# Ambientes: passo a passo de montagem

Registro de **todo passo** executado para montar cada ambiente, na ordem em que foi feito, com as armadilhas encontradas. Regra: quem monta ou altera um ambiente atualiza este arquivo na mesma sessão. O objetivo é que outra pessoa consiga reproduzir tudo sem consultar o histórico do chat.

- [1. Local (desenvolvimento e testes)](#1-local-desenvolvimento-e-testes)
- [2. Produção (Magalu Cloud)](#2-produção-magalu-cloud)

---

## 1. Local (desenvolvimento e testes)

### 1.1 Pré-requisitos

- Node 24 (`nvm use`, lê o `.nvmrc`). Com outro Node ativo, o `pnpm` pode nem estar no PATH: rode `nvm use` antes de tudo.
- pnpm 11 (via corepack: `corepack enable`).
- Docker Desktop aberto. Os contêineres têm `restart: unless-stopped` e voltam sozinhos quando o Docker abre.

### 1.2 Subir do zero

```bash
nvm use
pnpm install
cp .env.example .env
pnpm build                      # shared → api → web; a API e o front leem o dist/ do shared
pnpm infra:up                   # postgres, zitadel (api + login v2 + traefik), mailpit
pnpm infra:bootstrap -- --admin <seu-email>   # configura o Zitadel e preenche o .env (ver 1.4)
pnpm --filter @helpdesk/api prisma:migrate     # aplica as migrações no banco helpdesk
pnpm --filter @helpdesk/api prisma:seed        # dados de referência
pnpm dev
```

Na primeira subida, o Zitadel cria a instância, a organização "Missão Salesiana de Mato Grosso", o admin humano e dois service users. Os PATs deles ficam em `.local/zitadel/` (fora do git): `login-client.pat` (usado pelo Login V2) e `admin.pat` (`bootstrap-admin`, IAM_OWNER, usado pelo script de bootstrap).

### 1.3 Acessar o console do Zitadel

- URL: http://localhost:8080/ui/console
- Login: `zitadel-admin@missão-salesiana-de-mato-grosso.localhost` / `Password1!`

⚠️ **Armadilha:** o login name do admin usa o domínio gerado a partir do **nome da organização** (com o "ã"), não `zitadel.localhost`. Se a digitação do "ã" falhar, copie e cole.

⚠️ **Armadilha:** logado com um usuário comum (por exemplo, o seu próprio), o console mostra só o perfil pessoal, sem projetos, sem "Default settings" e sem a opção de marcar o e-mail como verificado. Para administrar, entre com o admin acima.

### 1.4 Configuração do Zitadel (script)

`pnpm infra:bootstrap -- --admin <email>` (`deploy/local/zitadel-bootstrap.mjs`) é idempotente e faz:

| Passo | O quê                                                                                                                                                                                                                                                    | Equivalente no console                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1     | Projeto **Help Desk** com _Assert Roles on Authentication_                                                                                                                                                                                               | Projects → Create; aba General               |
| 2     | Roles `admin`, `supervisor`, `agente` (as **keys** precisam ser exatamente essas)                                                                                                                                                                        | Projeto → Roles → New                        |
| 3     | App **Help Desk Web**: User Agent, PKCE (auth method none), code + refresh token, **Auth Token Type = JWT**, roles no access token e no ID token, redirect `http://localhost:5173/auth/callback`, post-logout `http://localhost:5173/`, Development Mode | Projeto → Applications → New; Token Settings |
| 4     | SMTP da instância → Mailpit (`mailpit:1025`, sem TLS, remetente `zitadel@localhost`), **ativo**                                                                                                                                                          | Default settings → SMTP Provider             |
| 5     | Com `--admin <email>`: role `admin` no projeto para esse usuário                                                                                                                                                                                         | Projeto → Authorizations → New               |
| 6     | Grava `ZITADEL_PROJECT_ID`, `VITE_ZITADEL_PROJECT_ID` e `VITE_ZITADEL_CLIENT_ID` no `.env`                                                                                                                                                               | Copiar os IDs à mão                          |

O usuário passado em `--admin` precisa existir. Crie-o no console (Users → New) ou faça login uma vez pelo portal.

⚠️ **Armadilha (SMTP):** o host é `mailpit`, não `localhost`. Dentro do contêiner do Zitadel, `localhost` é o próprio Zitadel. Antes do passo 4, o Zitadel não envia nenhum e-mail (verificação, reset de senha) e o usuário fica "não verificado" sem como receber o código.

### 1.5 Usuário de teste com e-mail não verificado

Se o usuário foi criado antes de o SMTP existir, ele fica "não verificado" e o reenvio de código falha (`Code is empty`). Duas saídas:

1. Com o SMTP já ativo (1.4): console do admin → usuário → "Reenviar código" → pegar o código em http://localhost:8025.
2. Pela API, com o PAT do `bootstrap-admin`: trocar o e-mail para um temporário e voltar para o original, as duas vezes com `isVerified: true`. Gravar o mesmo e-mail direto falha com `Email not changed`.

```bash
PAT=$(cat .local/zitadel/admin.pat); U=<user-id>
for e in temp+x@exemplo.com <email-original>; do
  curl -s -X POST http://localhost:8080/v2/users/$U/email -H "Authorization: Bearer $PAT" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$e\",\"isVerified\":true}"
done
```

### 1.6 Conferência

- `curl http://localhost:3000/api/health` → 200.
- `curl -i http://localhost:3000/api/me` → 401 `AUTH_MISSING` com `WWW-Authenticate: Bearer`.
- A API não sobe sem `ZITADEL_PROJECT_ID` no `.env`: rode o bootstrap.

### 1.7 Login de ponta a ponta e claims do token

1. Com `pnpm dev` no ar, abrir **http://localhost:5173** numa aba nova. O app redireciona para o Zitadel com `requestId=oidc_V2_…` na URL; depois do login volta para `/auth/callback` e cai em `/primeiro-acesso` (usuário sem unidade).
2. Conferir no banco: `docker compose exec -T postgres psql -U helpdesk -d helpdesk -c "select email, roles, zitadel_sub from users where zitadel_sub is not null"` → o usuário com `{admin}`.
3. Claims do access token: DevTools → Network → requisição `me` → copiar o header `Authorization` → no terminal `pbpaste | node deploy/local/decode-jwt.mjs` (mascara sub, jti, client id, e-mail e nome; não imprime o token). Nunca cole o token em chat ou ticket.

4. Primeiro acesso (T16): a tela lista as unidades e os departamentos ativos do seed (`prisma:seed`). Depois de salvar, o admin cai em `/fila/meus`. Para refazer o teste: `docker compose exec -T postgres psql -U helpdesk -d helpdesk -c "update users set company_id = null, department_id = null where email = '<email>'"` e aguardar até 60 s (cache da API) ou reiniciar o `pnpm dev`.

⚠️ **Armadilha:** entrar direto na tela de login do Zitadel (ou numa aba antiga dele) faz um login "solto", sem `requestId`: termina em `/ui/v2/login/signedin` ("Você está conectado") e não volta para o app. Sempre comece pelo `localhost:5173`.

ℹ️ O access token local dura **12 h** (padrão do Zitadel). Ver spec T04–T05 §10.

### 1.8 Anexos (storage local)

- Em dev, `STORAGE_DRIVER=local`: os arquivos vão para `STORAGE_LOCAL_PATH` (padrão `./storage`, relativo à pasta de onde a API roda, ou seja, `apps/api/storage/`). A pasta é criada sob demanda e está no `.gitignore`. Não há MinIO nem bucket local (ADR-009).
- Os testes e2e usam uma pasta temporária própria (`$TMPDIR/helpdesk-e2e-storage`, definida em `apps/api/vitest.config.e2e.ts`), que a suíte de anexos limpa.
- `pnpm infra:reset` **não** apaga `apps/api/storage/`: depois de um reset os arquivos antigos ficam órfãos. Apague a pasta à mão se quiser começar do zero.

### 1.9 E-mails de saída (Mailpit)

- Em dev, a API envia para o Mailpit (`SMTP_HOST=localhost`, `SMTP_PORT=1025`, sem usuário). Os e-mails aparecem em **http://localhost:8025**. Nada sai para a internet.
- O cron da outbox roda a cada minuto (`NOTIFICATIONS_ENABLED=true`). Depois de abrir ou responder um chamado, o e-mail chega ao Mailpit em até 1 min.
- Situação da fila: `docker compose exec -T postgres psql -U helpdesk -d helpdesk -c "select template, to_email, status, attempts, last_error, send_after from notifications order by created_at desc limit 20"`.
- Os destinatários precisam ter e-mail real no banco. O seed põe `suporte@missaosalesiana.org.br` no grupo "Suporte TI", que é a própria caixa do help desk. Por isso o aviso de chamado novo vai para cada agente do grupo, nunca para `suporte@`. Para testar o aviso ao grupo, entre em `group_members` com o seu usuário.
- Os testes e2e também usam o Mailpit (CTs 📬 da T14) e deixam e-mails com domínio `helpdesk.test` na caixa. Limpe pelo botão "Delete all" do Mailpit.

### 1.10 Reset

`pnpm infra:reset` apaga os volumes (Zitadel e bancos do zero). Depois: `pnpm infra:up`, `pnpm infra:bootstrap -- --admin <email>` (o projeto ganha um ID novo, e o script atualiza o `.env`), migrações e seed. Os usuários do Zitadel somem: crie de novo.

---

## 2. Produção (Magalu Cloud)

> **A documentar à medida que for executado.** Cada item abaixo vem do plano (`docs/discovery/05-plano-mvp.md` §5.2) e vira um passo a passo detalhado (console, comandos, valores não secretos, armadilhas) quando for feito. Segredos nunca entram aqui: só o nome do Secret e de onde o valor vem.

| #   | Etapa                                                                                                                                                                | Status   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Caixa `suporte-teste@missaosalesiana.org.br`: usuário no Workspace, verificação em 2 etapas, senha de app                                                            | pendente |
| 2   | Cluster Kubernetes, DBaaS (bancos `zitadel` e `helpdesk`), registry, bucket de anexos (ver 2.1)                                                                      | pendente |
| 3   | DNS (`suporte.msmt.org.br`, `auth.msmt.org.br`), Traefik, cert-manager                                                                                               | pendente |
| 4   | Zitadel v4.19.5 via Helm (`deploy/zitadel`): org, projeto, roles, app SPA (JWT), branding. Mesmos passos do 1.4, com redirects de produção e sem Development Mode    | pendente |
| 5   | IdP Google: app OAuth "Internal" no Google Cloud + IdP na org do Zitadel                                                                                             | pendente |
| 6   | Login real e claims do access token na §10 da spec T04–T05 (local já capturado; repetir em produção). **Decidir o Access Token Lifetime** (padrão 12 h × 1 h do ADR) | pendente |
| 7   | Senha de app de `suporte@` (produção); anotar onde se desconecta a caixa no Freshdesk. SMTP: ver 2.2                                                                 | pendente |
| 8   | Deploy do app (`make deploy`, T17), Secrets, migração                                                                                                                | pendente |
| 9   | CronJob de backup e **teste de restore**                                                                                                                             | pendente |
| 10  | Monitor de disponibilidade; verificação em 2 etapas obrigatória para os agentes no Workspace                                                                         | pendente |
| 11  | Virada do e-mail (`05-plano-mvp.md` §5.4)                                                                                                                            | pendente |

### 2.1 Bucket de anexos (Object Storage)

A preparar junto com a etapa 2. O código já está pronto (T13, driver `s3` com `@aws-sdk/client-s3`, `forcePathStyle`).

- Bucket **privado** `helpdesk-anexos` na região `br-se1`. Sem acesso público, sem CORS, sem URL pré-assinada: todo upload e download passa pela API (ADR-009).
- Endpoint: `https://br-se1.magaluobjects.com` (visto na configuração de Magalu do rclone). ⚠️ Confirmar no painel da Magalu ao criar o bucket.
- Par de chaves com acesso só a esse bucket. Valores no Secret do app: `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION=br-se1`, `S3_BUCKET=helpdesk-anexos`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Com `STORAGE_DRIVER=s3`, a API não sobe se faltar alguma delas.
- Teste depois do deploy: anexar um arquivo num ticket, baixar e conferir o objeto em `attachments/<ano>/<mês>/<uuid>` no bucket.
- O bucket também vai guardar os `.eml` brutos (T21) e os dumps do backup (etapa 9, possivelmente em outro bucket).

### 2.2 E-mail de saída (SMTP do Gmail)

A preparar com as etapas 1 e 7. O código já está pronto (T14).

- A Magalu Cloud não tem serviço de envio de e-mail. Os termos de uso proíbem usar a infraestrutura para enviar e-mail transacional "diretamente via SMTP". A nossa leitura é que isso veta um servidor de e-mail próprio, e não o envio autenticado pelo Gmail. ⚠️ **Confirmar com o suporte da Magalu** e testar se o cluster consegue sair pela porta 587 antes da virada.
- Valores no Secret do app: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS), `SMTP_USER=suporte@missaosalesiana.org.br`, `SMTP_PASSWORD=<senha de app>`, `MAIL_FROM="Suporte MSMT <suporte@missaosalesiana.org.br>"`, `PORTAL_URL=https://suporte.msmt.org.br`, `MAIL_MESSAGE_ID_DOMAIN=suporte.msmt.org.br`.
- Teste com `suporte-teste@` (etapa 1): abrir um chamado, conferir no Gmail do destinatário (menu "Mostrar original") se o `Message-ID` saiu como `<tk-…@suporte.msmt.org.br>`, e não reescrito pelo Gmail, e se as respostas seguintes ficam no mesmo thread.
- Monitorar `notifications` com `status = 'failed'`. O `last_error` traz o código SMTP (sem conteúdo). Limite do Workspace: cerca de 2.000 envios por dia.
