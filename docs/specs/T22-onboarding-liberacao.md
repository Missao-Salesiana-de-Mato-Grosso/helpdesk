# Spec T22 — Onboarding com liberação assistida

> Status: rascunho · Tarefas: T22 · Depende de: T05 (JIT), T15 (admin de usuários), T16 (1º acesso), T14 (outbox) · Origem: ADR-011 · Revisada em: 25/10/2026 (respostas do §12 incorporadas)

## 1. Objetivo

O portal passa a aceitar **qualquer conta Google** (tela de consentimento **Externo**, ADR-011) e, para quem não tem Google, um **cadastro próprio no Zitadel** com os mesmos dados que o Google entrega (nome, sobrenome, e-mail verificado). Mas só usa o help desk quem o **admin ou supervisor do suporte liberar**. Todo usuário novo, interno ou de fora, entra, informa unidade e departamento e fica **aguardando liberação**. O admin vê a fila, confere ou corrige unidade e departamento e **aprova ou recusa**. Pedido sem resposta em 30 dias vai para a **lixeira**, de onde pode ser recuperado. Até ser aprovado, o usuário não vê nem abre chamado pelo portal. O canal de e-mail continua aberto como hoje.

## 2. Fora de escopo

- Outros IdPs (Microsoft etc.): continua Google + cadastro próprio do Zitadel (RN-21 a RN-25). Senha, verificação de e-mail e recuperação de senha são do Zitadel; o app só recebe tokens.
- Aprovação automática por domínio (ex.: `@missaosalesiana.org.br` entra direto): decisão de 25/10 é que **todos** passam pela liberação. Se mudar, vira uma variável de configuração.
- Abertura de chamado por e-mail: não muda (T21). Quem manda e-mail continua gerando ticket, aprovado ou não.
- CRUD de unidades e departamentos: Fase 2 (seed e carga inicial).
- Convite por e-mail feito pelo admin (cadastro prévio): descartado em 25/10 em favor da fila.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                               | Fonte                   | Confirmar?                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| A tela de consentimento do Google está como **Externo** desde 25/10/2026; qualquer conta Google consegue autenticar                | 💡 `ambientes.md` P12   | —                                                |
| O Zitadel cria o usuário no 1º login pelo Google (criação permitida) e o `userinfo` traz nome, e-mail e `email_verified`           | 📘 Zitadel / T04–T05    | —                                                |
| Contas Google com e-mail que não é Gmail têm o e-mail verificado pelo próprio Google                                               | 📘 Google               | ⚠️ Conferir o `email_verified` numa conta dessas |
| O guard já bloqueia tudo com `ONBOARDING_REQUIRED` enquanto falta unidade ou departamento, exceto rotas `@AllowDuringOnboarding()` | 💡 `auth/auth.guard.ts` | —                                                |
| Quem libera: papéis `admin` e `supervisor`                                                                                         | 💡 25/10                | —                                                |
| O cadastro próprio do Zitadel (Login V2) pede nome, sobrenome, e-mail e senha, e envia um código para verificar o e-mail           | 📘 Zitadel              | ⚠️ Conferir no v4.19.5                           |
| Para enviar o código, o Zitadel de produção precisa de SMTP próprio, que **ainda não está configurado**                            | 💡 `ambientes.md`       | ⚠️ Pendência P13                                 |

## 4. Regras de negócio

### Estado de acesso

- **RN-01** — Todo usuário tem um `access_status`: `pending` (aguardando liberação), `approved` (liberado), `rejected` (recusado) ou `trashed` (na lixeira, RN-19). Ele é independente de `active`, que continua servindo para desligar alguém já liberado.
- **RN-02** — **Migração:** quem já existe no banco quando a T22 entra fica `approved`. Assim agentes e solicitantes atuais não são barrados.
- **RN-03** — Usuário criado no 1º login (JIT) nasce `pending`. Usuário criado pelo canal de e-mail (T21) também nasce `pending`. Isso não afeta o e-mail, só o portal.
- **RN-04** — **Quem tem role no token** (`admin`, `supervisor`, `agente`) é tratado como `approved` em toda requisição e, se estiver `pending`, passa a `approved` com evento de auditoria (`approved_by = null`, motivo "role concedida no Zitadel"). A role já é uma liberação dada no Zitadel, e isso evita que o admin fique trancado fora do próprio sistema.

### O que o usuário pendente pode fazer

- **RN-05** — Fluxo do usuário novo: login com Google **ou** cadastro próprio (RN-21) → tela de 1º acesso (unidade e departamento, já existente) → tela **"Aguardando liberação"**. A unidade e o departamento informados são uma **sugestão** para o admin.
- **RN-06** — Com `pending`, `rejected` ou `trashed`, a API responde **403** com `ACCESS_PENDING` (pendente ou na lixeira) ou `ACCESS_REJECTED` a toda rota, exceto `GET /me`, `PATCH /me` (enquanto `pending`) e as rotas de listas usadas no 1º acesso (`GET /companies`, `GET /departments`). Essas rotas são marcadas com um decorator explícito (`@AllowWhilePending()`), no mesmo padrão do `@AllowDuringOnboarding()`.
- **RN-07** — O bloqueio fica **no guard global**, como o do onboarding, e não só no front. O `GET /me` devolve `accessStatus`, e o front usa isso para escolher a tela.
- **RN-08** — Tela "Aguardando liberação": explica que o suporte precisa liberar o acesso, mostra a unidade e o departamento informados (com opção de corrigir) e oferece o e-mail `suporte@missaosalesiana.org.br` para quem tiver urgência. Tela "Acesso não liberado" para `rejected`: texto fixo, sem motivo interno, com o mesmo e-mail de contato.
- **RN-09** — **Vínculo pelo e-mail:** quem já mandou e-mail e tem usuário sem login é vinculado no 1º login, como hoje (spec T04–T05), **mantendo o `access_status`**. O bloqueio atual `EXTERNAL_USER_CANNOT_LOGIN` deixa de existir: um terceiro pode entrar e fica `pending` como qualquer pessoa.

### Liberação pelo admin

- **RN-10** — O admin ou supervisor vê a **fila de liberação**: usuários `pending`, do mais antigo para o mais novo, com nome, e-mail, data do 1º login, unidade e departamento sugeridos e um indicador de "e-mail de fora do domínio institucional" (`INTERNAL_EMAIL_DOMAINS`) e de "conta própria (sem Google)". O menu de admin e supervisor mostra a contagem. Nesta spec, "admin" quer dizer `admin` ou `supervisor`.
- **RN-11** — **Aprovar** exige unidade e departamento (o admin confirma ou troca os sugeridos) e, opcionalmente, marca `is_external`. Grava `approved`, `access_decided_by` e `access_decided_at`.
- **RN-12** — **Recusar** grava `rejected`, quem decidiu e quando. Um motivo interno opcional fica só no registro do admin e nunca é mostrado ao usuário.
- **RN-13** — O admin pode **rever a decisão**: tornar `approved` um `rejected` e vice-versa, pela mesma tela de usuários da T15. Revogar acesso de quem já usa o sistema continua sendo `active = false` (T15).
- **RN-14** — Toda decisão (aprovar, recusar, rever, aprovação automática da RN-04) vai para o log com o id do usuário e de quem decidiu, sem e-mail nem nome.
- **RN-15** — Mudar o `access_status` **invalida o cache de usuário** (`UserCache`) daquele `sub`, para que a decisão valha na requisição seguinte e não só depois do TTL.

### Notificações (pela outbox, T14)

- **RN-16** — Quando alguém entra na fila (`pending` com unidade e departamento preenchidos pela 1ª vez), os admins e supervisores ativos recebem um e-mail "Novo pedido de acesso ao help desk" com nome, e-mail e o link da fila. No máximo um por usuário.
- **RN-17** — Quando o admin aprova, o usuário recebe "Seu acesso ao help desk foi liberado" com o link do portal. Recusa **não** gera e-mail.
- **RN-18** — Esses e-mails não têm ticket: não levam `[#n]` no assunto nem entram em `email_message_refs`. O `NotificationService.enqueue` ganha esse tipo de notificação sem ticket.

### Dados pessoais (LGPD)

- **RN-19** — **Lixeira:** pedido `pending` sem decisão há mais de `ACCESS_REQUEST_TRASH_DAYS` (30) dias desde `access_requested_at` vai para `trashed` (soft-delete: grava `trashed_at`, **nada é apagado**), por um cron diário. Sai da fila e aparece na aba **Lixeira** da tela de liberação. Só `pending` vai para a lixeira; `rejected` fica como está.
- **RN-19a** — **Recuperar:** o admin restaura um item da lixeira para `pending` (volta para a fila com novo `access_requested_at`) ou o aprova direto (RN-11). Se a própria pessoa entrar de novo enquanto está na lixeira, o pedido volta para `pending` sozinho e os admins são avisados (RN-16), porque a demora foi do suporte.
- **RN-19b** — Quem tem ticket ou já foi `approved` alguma vez nunca vai para a lixeira.
- **RN-20** — O `04-lgpd.md` ganha a finalidade "pedido de acesso ao portal", a regra da lixeira e o prazo de exclusão definitiva da lixeira (⚠️ §12).

### Cadastro sem conta Google

- **RN-21** — A tela de login oferece, além do botão do Google, **"Solicitar cadastro"**: o registro do próprio Zitadel, com os mesmos dados que o Google entrega ao app (nome, sobrenome, e-mail) mais uma senha. O texto da tela orienta: "Tem conta Google? Entre com o Google."
- **RN-22** — O e-mail precisa estar **verificado** no Zitadel. O app recusa com `EMAIL_NOT_VERIFIED` (403) **qualquer** login com `email_verified = false`, não só o vínculo pelo e-mail como hoje.
- **RN-23** — Depois de verificado, o fluxo é o mesmo do Google: 1º acesso → `pending` → fila (RN-05 a RN-19). O app não diferencia as duas origens além do indicador da RN-10 (lido do IdP do usuário no `userinfo`, ⚠️ confirmar o claim).
- **RN-24** — **Ordem de ativação no Zitadel:** o registro só é ligado ("Registro de usuários permitido") **depois** que a T22 estiver em produção e o SMTP do Zitadel estiver configurado (P13). Antes disso, ligar o registro permitiria criar contas sem verificação útil e sem fila.
- **RN-25** — E-mail de domínio institucional (`INTERNAL_EMAIL_DOMAINS`) no cadastro próprio: ⚠️ §12. Sugestão: o app recusa com `USE_GOOGLE_LOGIN` (403) e a mensagem "Use o botão Google com sua conta institucional", para não haver duas contas para a mesma pessoa.

## 5. Contrato da API

| Rota                                        | Papéis                        | Request                                      | Response / erros                                                           |
| ------------------------------------------- | ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /me`                                   | qualquer autenticado          | —                                            | + `accessStatus`                                                           |
| `PATCH /me`                                 | qualquer, inclusive `pending` | unidade e departamento (já existe)           | 403 `ACCESS_REJECTED` se recusado                                          |
| `GET /users/access-requests`                | `admin`, `supervisor`         | paginação                                    | lista da RN-10                                                             |
| `POST /users/:id/access/approve`            | `admin`, `supervisor`         | `{ companyId, departmentId, isExternal? }`   | 200 usuário; 404 se não existe; 409 se já `approved`; 422 sem unidade/dep. |
| `POST /users/:id/access/reject`             | `admin`, `supervisor`         | `{ note? }` (até 500 caracteres, só interno) | 200; 404; 409 se já `rejected`                                             |
| `GET /users/access-requests?status=trashed` | `admin`, `supervisor`         | paginação                                    | lixeira (RN-19)                                                            |
| `POST /users/:id/access/restore`            | `admin`, `supervisor`         | —                                            | 200 volta a `pending`; 409 se não está na lixeira                          |
| Demais rotas autenticadas                   | conforme hoje                 | —                                            | 403 `ACCESS_PENDING` / `ACCESS_REJECTED` (RN-06)                           |

Códigos novos em `ApiErrorCode`: `ACCESS_PENDING`, `ACCESS_REJECTED`, `USE_GOOGLE_LOGIN` (se a RN-25 for aprovada). Removido: `EXTERNAL_USER_CANNOT_LOGIN` (RN-09). Schemas zod em `packages/shared`.

## 6. Dados

- `users`: `access_status` (enum `UserAccessStatus`: `pending | approved | rejected | trashed`, `NOT NULL`), `trashed_at` (timestamptz, nulo), `access_decided_by` (uuid, FK `users`, nulo), `access_decided_at` (timestamptz, nulo), `access_note` (text, nulo), `access_requested_at` (timestamptz, nulo: quando entrou na fila, RN-16).
- Migração nova: adiciona as colunas com default `approved` para as linhas existentes (RN-02) e depois troca o default da coluna para `pending` (RN-03).
- Índice parcial em `users(access_requested_at) WHERE access_status = 'pending'` para a fila.

## 7. Configuração

| Variável                    | Dev  | Produção | Uso   |
| --------------------------- | ---- | -------- | ----- |
| `ACCESS_REQUEST_TRASH_DAYS` | `30` | `30`     | RN-19 |

Zitadel: depois da T22 em produção, configurar o SMTP do Zitadel (P13) e ligar "Registro de usuários permitido" (RN-24). Google: nenhuma mudança além da P12.

## 8. Casos de borda

- Admin aprova e o usuário está com a tela aberta: a próxima chamada já passa (RN-15); a tela de espera consulta `GET /me` a cada 60 s e entra sozinha.
- Duas decisões simultâneas sobre o mesmo usuário: a segunda recebe 409 (transição condicionada ao status atual).
- Usuário recusado manda e-mail: vira ticket normalmente (canal de e-mail aberto). O agente vê o ticket e pode pedir ao admin para rever (RN-13).
- Agente recebe a role no Zitadel antes de ser aprovado: RN-04 aprova sozinho no próximo request.
- Pessoa sem conta Google: usa "Solicitar cadastro" (RN-21). Se não receber o código de verificação, o Zitadel permite reenviar; sem SMTP do Zitadel, o cadastro não funciona (RN-24).
- Pessoa se cadastra com senha e depois tenta entrar pelo Google com o mesmo e-mail: o Zitadel trata como outra conta; o app recusa a segunda com `WRONG_ORGANIZATION` (regra atual de e-mail já vinculado). O runbook (T20) explica como unir as contas no Zitadel.
- Unidade sugerida errada: o admin corrige no ato de aprovar (RN-11).

## 9. Casos de teste

| CT    | Dado                                                              | Quando                                              | Então                                                                                      | Cobre         |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| CT-01 | Usuários existentes antes da migração                             | Migração aplicada                                   | Todos `approved`                                                                           | RN-02         |
| CT-02 | Token válido de `sub` novo, sem role                              | 1º request                                          | Usuário criado `pending`                                                                   | RN-03         |
| CT-03 | Usuário `pending`                                                 | `GET /tickets`, `POST /tickets`, `GET /tickets/:id` | 403 `ACCESS_PENDING`                                                                       | RN-06         |
| CT-04 | Usuário `pending`                                                 | `GET /me`, `PATCH /me`, `GET /companies`            | 200                                                                                        | RN-06         |
| CT-05 | Usuário `rejected`                                                | `PATCH /me` e `GET /tickets`                        | 403 `ACCESS_REJECTED`; `GET /me` 200 com `accessStatus = rejected`                         | RN-06, RN-08  |
| CT-06 | Usuário `pending` com role `agente` no token                      | Qualquer request                                    | Passa e fica `approved`, com log de aprovação automática                                   | RN-04         |
| CT-07 | Usuário criado pelo e-mail com `is_external = true`               | 1º login com o mesmo e-mail verificado              | Vinculado, `pending`, sem `EXTERNAL_USER_CANNOT_LOGIN`                                     | RN-09         |
| CT-08 | Três `pending` em datas diferentes                                | Admin `GET /users/access-requests`                  | Ordem do mais antigo, com unidade e departamento sugeridos                                 | RN-10         |
| CT-09 | Usuário `pending`                                                 | Admin aprova com outra unidade                      | `approved`, unidade trocada, decisor e data gravados; próxima request do usuário passa     | RN-11, RN-15  |
| CT-10 | Usuário `pending`                                                 | Admin aprova sem departamento                       | 422; continua `pending`                                                                    | RN-11         |
| CT-11 | Usuário `pending`                                                 | Admin recusa com nota                               | `rejected`; `GET /me` do usuário não expõe a nota                                          | RN-12         |
| CT-12 | Usuário `approved`                                                | Admin aprova de novo                                | 409                                                                                        | §5            |
| CT-13 | Solicitante e agente                                              | Rotas de liberação                                  | 403 `FORBIDDEN_ROLE` (matriz de permissões)                                                | §5            |
| CT-14 | Usuário completa o 1º acesso                                      | `PATCH /me`                                         | Um e-mail para cada admin ativo na outbox; segundo `PATCH /me` não gera outro              | RN-16         |
| CT-15 | Admin aprova                                                      | —                                                   | E-mail de liberação na outbox, sem `[#n]` e sem `email_message_refs`; recusa não gera      | RN-17, RN-18  |
| CT-16 | `pending` há 31 dias sem ticket; outro há 29; um `rejected` há 40 | Cron da lixeira                                     | O primeiro vai para `trashed` com `trashed_at`; os outros não mudam; nenhuma linha apagada | RN-19, RN-19b |
| CT-18 | Usuário na lixeira                                                | Admin restaura                                      | `pending`, volta à fila com novo `access_requested_at`                                     | RN-19a        |
| CT-19 | Usuário na lixeira                                                | Ele mesmo faz login                                 | Volta a `pending`; e-mail aos admins e supervisores na outbox                              | RN-19a, RN-16 |
| CT-20 | Supervisor                                                        | Aprova um `pending`                                 | 200 `approved`                                                                             | RN-10         |
| CT-21 | Token com `email_verified = false`, `sub` novo                    | 1º request                                          | 403 `EMAIL_NOT_VERIFIED`; nenhum usuário criado                                            | RN-22         |
| CT-22 | Cadastro próprio com e-mail verificado                            | 1º request e `PATCH /me`                            | `pending`, entra na fila com o indicador "conta própria"                                   | RN-23, RN-10  |
| CT-17 | E-mail de remetente desconhecido                                  | Processado pela T21                                 | Ticket criado como hoje; usuário `pending`                                                 | RN-03         |

Front (Vitest + Testing Library): redireciona `pending` para "Aguardando liberação" e `rejected` para "Acesso não liberado"; fila do admin aprova e recusa; badge com a contagem.

## 10. Decisões tomadas na implementação

(preencher depois da sessão)

## 11. Impactos em documentos

- `CLAUDE.md`: a regra "usuários com `is_external = true` nunca fazem login" passa a "terceiros entram no portal só depois de liberados"; acrescentar a liberação nas regras de segurança.
- `01-escopo.md`: fluxos 2 e a linha de terceiros; matriz de permissões com o papel "pendente".
- `04-lgpd.md`: RN-19 e RN-20.
- `ambientes.md`: P12 resolvida quando a T22 estiver em produção.

## 12. Perguntas em aberto

Respondidas em 25/10/2026: `supervisor` também libera (RN-10); quem não tem Google faz cadastro próprio no Zitadel com os mesmos dados (RN-21 a RN-25); pedido sem resposta em 30 dias vai para a lixeira, recuperável (RN-19).

1. ⚠️ A lixeira tem exclusão definitiva depois de algum prazo (ex.: 1 ano), ou guarda para sempre? A LGPD pede um prazo.
2. ⚠️ RN-25: bloquear cadastro próprio com e-mail institucional, obrigando o botão Google?

## 13. Prompt sugerido para a sessão

```text
Leia docs/specs/T22-onboarding-liberacao.md e o ADR-011. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, a migração (com o SQL revisado), a ordem de implementação e como cada CT vira teste (incluindo as linhas novas na matriz de permissões). Aguarde minha aprovação.
```
