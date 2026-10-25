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

### 1.10 E-mails de entrada (pasta `.inbox`)

- Em dev, `MAILBOX_DRIVER=folder`: o cron (1 min) processa cada `*.eml` em `apps/api/.inbox/` (pasta no `.gitignore`) e o move para `processado/`, `descartado/` ou `erro/`, o equivalente aos rótulos do Gmail. Sem IMAP e sem caixa real.
- Para simular um e-mail: copie uma fixture, trocando o `Message-ID` (o mesmo id duas vezes é ignorado) e o `Date:`. Exemplo: `sed "s/<CAnovo001@mail.gmail.com>/<teste-$(date +%s)@x>/; s/^Date: .*/Date: $(date -R)/" apps/api/test/fixtures/inbound/novo-interno.eml > apps/api/.inbox/teste.eml`. Em até 1 min vira ticket, e a confirmação aparece no Mailpit no ciclo seguinte da outbox.
- Para responder a um ticket, use um `.eml` com `In-Reply-To:` igual ao `Message-ID` de um e-mail que o Mailpit recebeu dele (ou `Subject:` com `[#número]`, se o remetente for o solicitante ou um agente).
- Situação: `docker compose exec -T postgres psql -U helpdesk -d helpdesk -c "select status, reason, from_email, ticket_id, created_at from inbound_emails order by created_at desc limit 20"`.
- ⚠️ **Armadilha:** com `MAILBOX_START_SINCE` preenchido, os `.eml` com `Date:` anterior vão para `ignorado/` sem virar ticket. Em dev, deixe vazio.
- Os testes e2e usam a pasta temporária `$TMPDIR/helpdesk-e2e-inbox` e nunca tocam o Gmail.

### 1.11 Reset

`pnpm infra:reset` apaga os volumes (Zitadel e bancos do zero). Depois: `pnpm infra:up`, `pnpm infra:bootstrap -- --admin <email>` (o projeto ganha um ID novo, e o script atualiza o `.env`), migrações e seed. Os usuários do Zitadel somem: crie de novo.

---

## 2. Produção (Magalu Cloud)

> **Antes de começar, veja as pendências em 2.0.** **A documentar à medida que for executado.** Cada item abaixo vem do plano (`docs/discovery/05-plano-mvp.md` §5.2) e vira um passo a passo detalhado (console, comandos, valores não secretos, armadilhas) quando for feito. Segredos nunca entram aqui: só o nome do Secret e de onde o valor vem.

> **Plataforma (etapas 2 e 3):** criada pelo repositório irmão `msmt-infra-automation` (`../msmt-infra-automation`), com scripts idempotentes do CLI `mgc`: `make preflight`, depois `make registry storage cluster database addons`. Ele gera as senhas do banco, a chave do Object Storage e o kubeconfig em `secrets/` (fora do git) e imprime o IP do Traefik para o DNS. O passo a passo, os valores a preencher em `config/prod.env` e o que conferir na 1ª execução estão no README de lá. Este repositório continua dono do deploy do app e do Zitadel (`deploy/k8s`, `deploy/zitadel`).

| #   | Etapa                                                                                                                                                             | Status                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Caixa `suporte-teste@missaosalesiana.org.br`: usuário no Workspace, verificação em 2 etapas, senha de app                                                         | pendente                     |
| 2   | Cluster Kubernetes, DBaaS (bancos `zitadel` e `helpdesk`), registry, bucket de anexos (ver 2.1)                                                                   | feito 2026-10-25 (ver 2.0.1) |
| 3   | DNS (`suporte.msmt.org.br`, `auth.msmt.org.br`), Traefik, cert-manager                                                                                            | feito 2026-10-25 (ver 2.0.1) |
| 4   | Zitadel v4.19.5 via Helm (`deploy/zitadel`): org, projeto, roles, app SPA (JWT), branding. Mesmos passos do 1.4, com redirects de produção e sem Development Mode | pendente                     |
| 5   | IdP Google: app OAuth "Internal" no Google Cloud + IdP na org do Zitadel                                                                                          | pendente                     |
| 6   | Login real e claims do access token na §10 da spec T04–T05 (local já capturado; repetir em produção). **Decidir o Access Token Lifetime** (P1)                    | pendente                     |
| 7   | Senha de app de `suporte@` (produção); anotar onde se desconecta a caixa no Freshdesk. SMTP: ver 2.2                                                              | pendente                     |
| 8   | Deploy do app (`make deploy`, T17), Secrets, migração                                                                                                             | pendente                     |
| 9   | CronJob de backup e **teste de restore**                                                                                                                          | pendente                     |
| 10  | Monitor de disponibilidade; verificação em 2 etapas obrigatória para os agentes no Workspace                                                                      | pendente                     |
| 11  | Virada do e-mail (`05-plano-mvp.md` §5.4)                                                                                                                         | pendente                     |

### 2.0 Pendências para o rollout

Decisões e confirmações em aberto que precisam estar resolvidas antes ou durante a subida em produção. Ao resolver uma, marque a data e mova o detalhe para a seção da etapa.

| #   | Pendência                                                                                                                                                                                               | Etapa | Quem            | Status                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------- | --------------------------------------------------------------- |
| P1  | **Decidir o Access Token Lifetime do Zitadel:** padrão de 12 h ou 1 h (recomendado; ADR). Não alterar sem decisão explícita                                                                             | 6     | dono do produto | aberta                                                          |
| P2  | **Confirmar com o suporte da Magalu** que o envio autenticado pelo Gmail (`smtp.gmail.com:587`) não fere os termos de uso ("e-mail transacional diretamente via SMTP"). Ver 2.2                         | 2, 7  | dono do produto | aberta                                                          |
| P3  | Testar se o cluster sai pela porta **587** (SMTP) e pela **993** (IMAP) até o Gmail. Se a 587 estiver bloqueada, a alternativa é um provedor SMTP externo (só muda `SMTP_*`; exige SPF/DKIM no DNS)     | 2     | desenvolvedor   | aberta                                                          |
| P4  | Confirmar o **endpoint do Object Storage** (`https://br-se1.magaluobjects.com`) no painel ao criar o bucket. O driver `s3` só foi testado com cliente falso: validar upload e download reais            | 2, 8  | desenvolvedor   | aberta                                                          |
| P5  | Com `suporte-teste@`: conferir se o Gmail **preserva o `Message-ID`** que enviamos (`<tk-…@suporte.msmt.org.br>`) e se as respostas ficam no mesmo thread. Se reescrever, a tag `[#n]` segura           | 1     | desenvolvedor   | aberta                                                          |
| P6  | Com `suporte-teste@` (T21; ver 2.3): conferir num e-mail real o cabeçalho `Authentication-Results: mx.google.com … dmarc=` e se copiar para o rótulo `helpdesk/processado` **mantém o e-mail na INBOX** | 1     | desenvolvedor   | aberta                                                          |
| P7  | Anotar no admin do Freshdesk (Admin → Canais → E-mail) **onde se desconecta a caixa** `suporte@`, para a virada e o rollback                                                                            | 7, 11 | dono do produto | aberta                                                          |
| P9  | A chave do Object Storage criada pelo `mgc` vale para **todos os buckets da conta** (o CLI não tem escopo por bucket). Aceitar, ou ver no painel se há chave restrita                                   | 2     | dono do produto | aberta                                                          |
| P10 | Conferir que o DBaaS é alcançável **a partir dos nós do cluster** (mesma rede privada). O `make database` cria os bancos por um pod `psql` dentro do cluster                                            | 2     | desenvolvedor   | resolvida 2026-10-25: o pod `psql` no cluster conectou ao DBaaS |
| P11 | **Renovar o kubeconfig** do `k8s-msmt-prd` antes de vencer (certificado de 1 ano, ~25/10/2027): `make cluster` no `msmt-infra-automation` baixa um novo. Incluir no runbook (T20) com lembrete          | 10    | desenvolvedor   | aberta                                                          |
| P8  | Depois da virada: acompanhar `notifications` com `status = 'failed'` e `inbound_emails` com `failed`/`discarded` (rótulo `helpdesk/erro`) por 2 h, e incluir isso no monitoramento                      | 10–11 | desenvolvedor   | aberta                                                          |

### 2.0.1 Execução da plataforma (`msmt-infra-automation`)

Registro do que foi executado na conta **MISSAO SALESIANA DE MATO GROSSO** (região `br-se1`), em ordem.

| Data       | Passo                                                                                                                                        | Resultado                                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-24 | `mgc` v0.48 → v0.67, `helm` 4.3, `kubectl` 1.37                                                                                              | ok                                                                                                                                                                                                                                                                |
| 2026-10-24 | DBaaS `pg-msmt-prd-web` pelo painel (PostgreSQL 17, BV1-4-10)                                                                                | **status Erro**; excluída pelo painel em 2026-10-25                                                                                                                                                                                                               |
| 2026-10-25 | `make cluster`: `k8s-msmt-prd`, v1.34.2, 2 × BV2-4-40                                                                                        | ok (~30 min); 3 nós de controle gerenciados + 2 de trabalho, IPs `172.18.x.x`                                                                                                                                                                                     |
| 2026-10-25 | `make registry`: `cr-msmt-prd`                                                                                                               | ok (já existia `cr-msmt-dev`, não usado aqui)                                                                                                                                                                                                                     |
| 2026-10-25 | Bucket `msmt-helpdesk` pelo painel (privado, versionado)                                                                                     | ok; `make storage` ainda cria as chaves (CLI e app)                                                                                                                                                                                                               |
| 2026-10-25 | `make storage`: chaves `msmt-infra-cli` (só o mgc) e `helpdesk-app`                                                                          | ok; par do app em `msmt-infra-automation/secrets/object-storage.env`                                                                                                                                                                                              |
| 2026-10-25 | `make database`: `pg-msmt-prd-web` recriada (PostgreSQL 17, BV1-4-10, 20 GB, `br-se1-a`, IP privado `172.18.3.73`)                           | ok; backup 7 dias às 05:00 UTC, protegida contra exclusão; bancos e usuários `zitadel` e `helpdesk` criados por pod no cluster; senhas em `msmt-infra-automation/secrets/database.env`                                                                            |
| 2026-10-25 | `make addons`: Traefik 42.1.3 (2 réplicas, LoadBalancer) e cert-manager v1.21.3 com `letsencrypt-staging` e `letsencrypt-prod`               | ok; **IP público `201.23.74.106`** (balanceador criado pela Magalu sem configuração extra)                                                                                                                                                                        |
| 2026-10-25 | DNS: `suporte.msmt.org.br` e `auth.msmt.org.br` → A `201.23.74.106`, TTL 300                                                                 | ok, na **Cloudflare**, proxy **desligado** (DNS only); HTTP → 301 para HTTPS; HTTPS responde 404 com o certificado padrão do Traefik até existirem as rotas dos apps                                                                                              |
| 2026-10-25 | `make zitadel`: Zitadel v4.19.5 (chart 10.4.0) em `https://auth.msmt.org.br`                                                                 | ok na 3ª tentativa (as 2 primeiras: imagem `alpine/k8s:1.34.2` inexistente, ver 2.4); certificado Let's Encrypt emitido; issuer, JWKS e Login V2 respondem 200                                                                                                    |
| 2026-10-25 | `make zitadel-bootstrap` com PAT do `iam-admin` gerado no console (o Secret `iam-admin-pat` se perdeu nas tentativas com imagem inexistente) | ok: projeto `396721163864172549`, app SPA client id `396721164417886213`, roles admin/supervisor/agente                                                                                                                                                           |
| 2026-10-25 | `make deploy` (imagem `helpdesk:5e990ee`)                                                                                                    | ok depois de criar o usuário do registry em `br-se1` (`mgc container-registry users create --region br-se1`); `https://suporte.msmt.org.br` com certificado Let's Encrypt, SPA e `/api/health` 200; e-mail (SMTP/IMAP) desligado até `secrets/helpdesk-email.env` |

Armadilhas encontradas:

- A fórmula do Homebrew é **`mgccli`** (o comando é `mgc`), e o Homebrew recente exige `brew trust magalucloud/mgccli` antes de instalar ou atualizar.
- O `mgc` v0.67 trocou os tipos de nó do Kubernetes pelos tipos de VM (`BV2-4-40` é o menor) e descontinuou `--enabled-server-group`.
- **Rodar os `make` numa janela do Terminal**, um por vez. Pelo `!` do Claude Code não há terminal para a confirmação `[s/N]`. Colar várias linhas de uma vez faz a linha seguinte virar a resposta da pergunta (cancela).
- Logo após o cluster ficar `running`, o `kube-user` do kubeconfig recebe "forbidden" por alguns minutos (permissões ainda sendo aplicadas). O script espera até 10 min.
- `mgc dbaas instances list` **não mostra instâncias com erro**; só com `--status ERROR`. Depois de excluir, esperar sair de `DELETING` antes de recriar com o mesmo nome.
- O DNS de `msmt.org.br` está na Cloudflare. Com o **proxy ligado (nuvem laranja)** os nomes resolvem para IPs da Cloudflare e o HTTPS dá **erro 526** (origem sem certificado válido); o Let's Encrypt também não valida. Manter **DNS only (nuvem cinza)**.
- O chart 42 do Traefik mudou o formato dos valores (`ports.<ep>.http.redirections`, `ports.<ep>.http.tls`, `accessLog`). O `make addons` valida os valores com `helm template` antes de instalar.
- No DBaaS, o mesmo rótulo de tipo (`BV1-4-10`) existe para cada engine: buscar o tipo com `--engine-id` do PostgreSQL.
- `mgc object-storage api-key current` sai com código 0 mesmo sem chave ("No current API key set!"): conferir o `uuid` no JSON.
- Os comandos de bucket do `mgc` exigem uma chave do Object Storage selecionada no CLI (`msmt-infra-cli`, separada da chave do app). Os comandos `object-storage api-key` não aceitam `--region`.

### 2.1 Bucket do help desk (Object Storage)

Criado pelo painel em 2026-10-25. O código já está pronto (T13, driver `s3` com `@aws-sdk/client-s3`, `forcePathStyle`).

- Convenção do ecossistema MSMT (o help desk é o 1º produto): **um bucket por produto**, `msmt-<produto>`, e uma pasta (prefixo) por uso dentro dele. Novas necessidades viram pastas irmãs, não buckets novos.
- Bucket **privado** `msmt-helpdesk` na região `br-se1`, com **versionamento** habilitado (protege contra exclusão ou sobrescrita acidental; versões antigas ocupam espaço). Sem acesso público, sem CORS, sem URL pré-assinada: todo upload e download passa pela API (ADR-009).
- Endpoint: `https://br-se1.magaluobjects.com` (visto na configuração de Magalu do rclone). ⚠️ Confirmar no painel da Magalu ao criar o bucket.
- Par de chaves gerado pelo `make storage` em `msmt-infra-automation/secrets/object-storage.env` (vale para a conta toda: ver P9). Valores no Secret do app: `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION=br-se1`, `S3_BUCKET=msmt-helpdesk`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Com `STORAGE_DRIVER=s3`, a API não sobe se faltar alguma delas.
- Teste depois do deploy: anexar um arquivo num ticket, baixar e conferir o objeto em `attachments/<ano>/<mês>/<uuid>` no bucket.
- Pastas (criadas sozinhas no 1º upload; não é preciso criá-las no painel):

  | Pasta          | Conteúdo                                 | Quem grava                           |
  | -------------- | ---------------------------------------- | ------------------------------------ |
  | `attachments/` | anexos dos tickets, `<ano>/<mês>/<uuid>` | API (T13)                            |
  | `inbound/`     | e-mails brutos, `<ano>/<mês>/<uuid>.eml` | API (T21)                            |
  | `backups/`     | dumps do PostgreSQL                      | CronJob de backup (etapa 9, a fazer) |

- ⚠️ Com backups no mesmo bucket, a chave do app (que vale para a conta toda, P9) também consegue apagá-los. O versionamento mitiga; ao fazer a etapa 9, avaliar uma chave própria para o backup ou cópia fora do bucket.

### 2.2 E-mail de saída (SMTP do Gmail)

A preparar com as etapas 1 e 7. O código já está pronto (T14).

- A Magalu Cloud não tem serviço de envio de e-mail. Os termos de uso proíbem usar a infraestrutura para enviar e-mail transacional "diretamente via SMTP". A nossa leitura é que isso veta um servidor de e-mail próprio, e não o envio autenticado pelo Gmail. ⚠️ **Confirmar com o suporte da Magalu** e testar se o cluster consegue sair pela porta 587 antes da virada.
- Valores no Secret do app: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS), `SMTP_USER=suporte@missaosalesiana.org.br`, `SMTP_PASSWORD=<senha de app>`, `MAIL_FROM="Suporte MSMT <suporte@missaosalesiana.org.br>"`, `PORTAL_URL=https://suporte.msmt.org.br`, `MAIL_MESSAGE_ID_DOMAIN=suporte.msmt.org.br`.
- Teste com `suporte-teste@` (etapa 1): abrir um chamado, conferir no Gmail do destinatário (menu "Mostrar original") se o `Message-ID` saiu como `<tk-…@suporte.msmt.org.br>`, e não reescrito pelo Gmail, e se as respostas seguintes ficam no mesmo thread.
- Monitorar `notifications` com `status = 'failed'`. O `last_error` traz o código SMTP (sem conteúdo). Limite do Workspace: cerca de 2.000 envios por dia.

### 2.3 E-mail de entrada (IMAP do Gmail)

A preparar com as etapas 1, 7 e 11. O código já está pronto (T21).

- Até a virada, a API lê `suporte-teste@`. **Nunca** apontar para `suporte@` enquanto o Freshdesk estiver conectado (os dois criariam tickets; §5.4 do plano).
- Valores no Secret do app: `MAILBOX_DRIVER=imap`, `MAILBOX_HOST=imap.gmail.com`, `MAILBOX_PORT=993`, `MAILBOX_USER`, `MAILBOX_PASSWORD` (a mesma senha de app do SMTP), `MAILBOX_START_SINCE` (na virada, a hora da desconexão do Freshdesk, com fuso: `2026-10-27T07:15:00-04:00`), `INTERNAL_EMAIL_DOMAINS=missaosalesiana.org.br`. Com `MAILBOX_DRIVER=imap`, a API não sobe sem usuário e senha.
- O IMAP precisa estar habilitado na conta (Gmail → Configurações → Encaminhamento e POP/IMAP). Os rótulos `helpdesk/processado`, `helpdesk/descartado` e `helpdesk/erro` são criados pela API na primeira vez.
- Conferência depois do deploy: o log mostra `Cursor inicial da INBOX: UID …`. Enviar um e-mail de teste e ver o ticket, o rótulo `helpdesk/processado` no Gmail (com o e-mail ainda na INBOX) e a confirmação no thread (P5 e P6 em 2.0).
- Monitorar `inbound_emails` com `status = 'failed'` e o rótulo `helpdesk/erro`. Para reprocessar um e-mail com falha: o runbook (T20) vai descrever o passo.
- Para recomeçar a leitura do zero (por exemplo, ao trocar de `suporte-teste@` para `suporte@`), apague as chaves `mailbox.last_uid` e `mailbox.uid_validity` em `app_settings` antes do deploy. Sem isso, a API usaria o cursor da outra caixa.

### 2.4 Publicação do Zitadel e do app (etapas 4, 5 e 8; T17)

Tudo pelo `Makefile` da raiz, **numa janela do Terminal** (cada alvo pergunta antes de alterar). Os scripts estão em `deploy/prod/`, leem os segredos de `../msmt-infra-automation/secrets/` (nunca impressos) e usam o kubeconfig de lá, nunca o contexto atual do `kubectl`. Pré-requisitos: plataforma pronta (2.0.1), Docker Desktop aberto, `mgc` logado.

| Ordem | Comando                                         | O que faz                                                                                                                                                                                                                                                                 |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `make zitadel`                                  | Gera (uma vez) masterkey, senha do admin de emergência e segredo do cookie do login em `secrets/zitadel.env`; cria os Secrets; instala o chart `zitadel/zitadel` 10.4.0 com imagem **v4.19.5** (`deploy/zitadel/values.yaml`); espera o certificado de `auth.msmt.org.br` |
| 2     | `make zitadel-bootstrap`                        | Projeto "Help Desk", roles e app SPA (sem Development Mode, redirects de `https://suporte.msmt.org.br`), com o PAT do Secret `iam-admin-pat`. Grava `ZITADEL_PROJECT_ID` e `VITE_ZITADEL_CLIENT_ID` em `deploy/k8s/overlays/prod/zitadel.env` (**commitar**)              |
| 3     | IdP Google (manual, abaixo)                     | Login com as contas `@missaosalesiana.org.br`                                                                                                                                                                                                                             |
| 4     | `make deploy`                                   | Build `linux/amd64` e push para `cr-msmt-prd`; Secrets `registry` e `helpdesk-secrets`; ConfigMap; Job de migração (`prisma migrate deploy` + seed); rollout; confere o certificado e `https://suporte.msmt.org.br/api/health`                                            |
| 5     | `make zitadel-bootstrap ARGS="--admin <email>"` | Depois do **primeiro login pelo Google** da pessoa: concede a role `admin` no projeto                                                                                                                                                                                     |
| —     | `make status`                                   | Só leitura: pods, certificados e saúde                                                                                                                                                                                                                                    |

**Sem o Secret `iam-admin-pat`** (o setup gera o PAT uma única vez; se o contêiner que o grava falhar, ele se perde): console como `zitadel-admin` → Usuários → aba **Usuários de serviço** → `iam-admin` → **Tokens de acesso pessoal** → Novo (validade longa) → copiar o token e gravá-lo, **sem colar em chat**, como linha `ZITADEL_BOOTSTRAP_PAT=<token>` em `../msmt-infra-automation/secrets/zitadel.env`. O `make zitadel-bootstrap` usa esse valor quando o Secret não existe.

**Admin de emergência do Zitadel:** usuário `zitadel-admin` (e-mail `zitadel-admin@msmt.org.br`, fora do Workspace para não colidir com contas Google), senha em `secrets/zitadel.env` (`ZITADEL_ADMIN_PASSWORD`). Console: `https://auth.msmt.org.br/ui/console`.

⚠️ **A masterkey (`ZITADEL_MASTERKEY`) nunca muda** depois da 1ª instalação: perdê-la ou trocá-la torna os dados cifrados do Zitadel ilegíveis. Guardar `secrets/zitadel.env` no cofre da equipe.

**IdP Google (etapa 5, manual):**

1. Google Cloud Console (projeto da organização) → APIs e serviços → Tela de consentimento OAuth: tipo **Interno** (só contas do Workspace).
2. Credenciais → Criar ID do cliente OAuth → **Aplicativo da Web**. URI de redirecionamento autorizado: `https://auth.msmt.org.br/idps/callback`. ⚠️ Conferir na tela do IdP no console do Zitadel, que mostra a URL de callback exata.
3. Console do Zitadel (como `zitadel-admin`) → Configurações padrão → Provedores de identidade → **Google**: client id e secret do passo 2; marcar criação automática, atualização automática e vinculação por e-mail.
4. Configurações padrão → Configurações de login: permitir login com IdP externo e **desmarcar "Registro de usuários permitido"**. O padrão do Zitadel mostra "Cadastrar novo usuário" na tela de login, e qualquer pessoa da internet criaria uma conta e entraria no help desk como solicitante. Manter o login por usuário e senha só enquanto o admin de emergência precisar.
5. Testar: abrir `https://suporte.msmt.org.br` em aba anônima e entrar com uma conta `@missaosalesiana.org.br`. Depois, passo 5 da tabela para dar a role `admin`.

**E-mail (SMTP e IMAP):** opcional no 1º deploy. Sem o arquivo abaixo, o app sobe com notificações e leitura da caixa **desligadas** (o `make deploy` avisa). Para ligar, crie `../msmt-infra-automation/secrets/helpdesk-email.env` (permissão 600) e rode `make deploy` de novo:

```
SMTP_USER=suporte-teste@missaosalesiana.org.br
SMTP_PASSWORD=<senha de app>
MAILBOX_USER=suporte-teste@missaosalesiana.org.br
MAILBOX_PASSWORD=<senha de app>
# Na virada: hora da desconexão do Freshdesk (ver 2.3)
MAILBOX_START_SINCE=
```

Armadilhas e decisões:

- O chart do Zitadel usa a imagem `alpine/k8s:<versão do cluster>` nos jobs. A `1.34.2` não existe no Docker Hub: o setup ficava em `ImagePullBackOff` até o prazo do job (`DeadlineExceeded`, sem log). Tag fixada em `tools.kubectl.image.tag`. Ao atualizar o cluster, conferir se a tag ainda serve.
- Credencial do Container Registry: no 1º uso, `mgc container-registry credentials get` (e também `credentials password`) responde `404 Error getting user`. Falta o **usuário do registry** do login atual: criar uma vez com `mgc container-registry users create --region br-se1`. **Usuário e credencial são por região**, e o `mgc` desta máquina tinha `br-ne1` como padrão (`mgc config get region`): sem `--region`, o usuário foi criado no Nordeste e o login em `br-se1` dava `unauthorized`. Os scripts passam `--region` sempre ([doc](https://docs.magalu.cloud/docs/containers-manager/container-registry/how-to/users/create-user)). O acesso aos registries é por papéis do próprio registry (`members`: Developer lê e escreve, Guest só lê), numa conta de organização com Turia IAM. O `make deploy` lê a credencial a cada execução.
- Excluir o cluster **não** apaga o balanceador do Service do Traefik nem volumes de PVC: apagar à mão ([doc](https://docs.magalu.cloud/docs/containers-manager/kubernetes/getting-started)).
- `DATABASE_URL` vai sem `sslmode` (rede privada). Se a migração falhar com "no pg_hba.conf entry … no encryption", o DBaaS exige TLS: acrescentar `&sslmode=no-verify` em `deploy/prod/app.sh`. O Zitadel usa `SSL.Mode: prefer`.
- O app roda com **1 réplica** e estratégia `Recreate`: os crons (outbox e IMAP) rodam no processo, e a leitura da caixa não deve rodar em paralelo.
- As variáveis `VITE_*` são embutidas no front no build. Trocar o client id do Zitadel exige novo `make deploy`.
- O `.dockerignore` excluía `**/storage` e levava junto o código de `src/attachments/storage/`: as exclusões de dados são só `/storage` e `apps/api/storage`.
