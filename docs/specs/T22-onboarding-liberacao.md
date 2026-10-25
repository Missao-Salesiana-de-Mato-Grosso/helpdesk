# Spec T22 — Onboarding com liberação assistida

> Status: rascunho · Tarefas: T22 · Depende de: T05 (JIT), T15 (admin de usuários), T16 (1º acesso), T14 (outbox) · Origem: ADR-011 · Revisada em: 25/10/2026

## 1. Objetivo

O portal passa a aceitar **qualquer conta Google** (tela de consentimento **Externo**, ADR-011), mas só usa o help desk quem o **admin do suporte liberar**. Todo usuário novo, interno ou de fora, entra, informa unidade e departamento e fica **aguardando liberação**. O admin vê a fila, confere ou corrige unidade e departamento e **aprova ou recusa**. Até ser aprovado, o usuário não vê nem abre chamado pelo portal. O canal de e-mail continua aberto como hoje.

## 2. Fora de escopo

- Login por usuário e senha ou outros IdPs (Microsoft etc.): continua só Google. O auto-cadastro do Zitadel fica desligado.
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
| Quem libera é o papel `admin`                                                                                                      | 💡 25/10                | ⚠️ `supervisor` também libera? (§12)             |

## 4. Regras de negócio

### Estado de acesso

- **RN-01** — Todo usuário tem um `access_status`: `pending` (aguardando liberação), `approved` (liberado) ou `rejected` (recusado). Ele é independente de `active`, que continua servindo para desligar alguém já liberado.
- **RN-02** — **Migração:** quem já existe no banco quando a T22 entra fica `approved`. Assim agentes e solicitantes atuais não são barrados.
- **RN-03** — Usuário criado no 1º login (JIT) nasce `pending`. Usuário criado pelo canal de e-mail (T21) também nasce `pending`. Isso não afeta o e-mail, só o portal.
- **RN-04** — **Quem tem role no token** (`admin`, `supervisor`, `agente`) é tratado como `approved` em toda requisição e, se estiver `pending`, passa a `approved` com evento de auditoria (`approved_by = null`, motivo "role concedida no Zitadel"). A role já é uma liberação dada no Zitadel, e isso evita que o admin fique trancado fora do próprio sistema.

### O que o usuário pendente pode fazer

- **RN-05** — Fluxo do usuário novo: login com Google → tela de 1º acesso (unidade e departamento, já existente) → tela **"Aguardando liberação"**. A unidade e o departamento informados são uma **sugestão** para o admin.
- **RN-06** — Com `pending` ou `rejected`, a API responde **403** com `ACCESS_PENDING` ou `ACCESS_REJECTED` a toda rota, exceto `GET /me`, `PATCH /me` (enquanto `pending`) e as rotas de listas usadas no 1º acesso (`GET /companies`, `GET /departments`). Essas rotas são marcadas com um decorator explícito (`@AllowWhilePending()`), no mesmo padrão do `@AllowDuringOnboarding()`.
- **RN-07** — O bloqueio fica **no guard global**, como o do onboarding, e não só no front. O `GET /me` devolve `accessStatus`, e o front usa isso para escolher a tela.
- **RN-08** — Tela "Aguardando liberação": explica que o suporte precisa liberar o acesso, mostra a unidade e o departamento informados (com opção de corrigir) e oferece o e-mail `suporte@missaosalesiana.org.br` para quem tiver urgência. Tela "Acesso não liberado" para `rejected`: texto fixo, sem motivo interno, com o mesmo e-mail de contato.
- **RN-09** — **Vínculo pelo e-mail:** quem já mandou e-mail e tem usuário sem login é vinculado no 1º login, como hoje (spec T04–T05), **mantendo o `access_status`**. O bloqueio atual `EXTERNAL_USER_CANNOT_LOGIN` deixa de existir: um terceiro pode entrar e fica `pending` como qualquer pessoa.

### Liberação pelo admin

- **RN-10** — O admin vê a **fila de liberação**: usuários `pending`, do mais antigo para o mais novo, com nome, e-mail, data do 1º login, unidade e departamento sugeridos e um indicador de "e-mail de fora do domínio institucional" (`INTERNAL_EMAIL_DOMAINS`). O menu do admin mostra a contagem.
- **RN-11** — **Aprovar** exige unidade e departamento (o admin confirma ou troca os sugeridos) e, opcionalmente, marca `is_external`. Grava `approved`, `access_decided_by` e `access_decided_at`.
- **RN-12** — **Recusar** grava `rejected`, quem decidiu e quando. Um motivo interno opcional fica só no registro do admin e nunca é mostrado ao usuário.
- **RN-13** — O admin pode **rever a decisão**: tornar `approved` um `rejected` e vice-versa, pela mesma tela de usuários da T15. Revogar acesso de quem já usa o sistema continua sendo `active = false` (T15).
- **RN-14** — Toda decisão (aprovar, recusar, rever, aprovação automática da RN-04) vai para o log com o id do usuário e de quem decidiu, sem e-mail nem nome.
- **RN-15** — Mudar o `access_status` **invalida o cache de usuário** (`UserCache`) daquele `sub`, para que a decisão valha na requisição seguinte e não só depois do TTL.

### Notificações (pela outbox, T14)

- **RN-16** — Quando alguém entra na fila (`pending` com unidade e departamento preenchidos pela 1ª vez), os admins ativos recebem um e-mail "Novo pedido de acesso ao help desk" com nome, e-mail e o link da fila. No máximo um por usuário.
- **RN-17** — Quando o admin aprova, o usuário recebe "Seu acesso ao help desk foi liberado" com o link do portal. Recusa **não** gera e-mail.
- **RN-18** — Esses e-mails não têm ticket: não levam `[#n]` no assunto nem entram em `email_message_refs`. O `NotificationService.enqueue` ganha esse tipo de notificação sem ticket.

### Dados pessoais (LGPD)

- **RN-19** — Usuário `pending` ou `rejected` **sem ticket** e sem login há mais de `ACCESS_REQUEST_RETENTION_DAYS` (90) é **excluído** por um cron diário. Quem tem ticket nunca é excluído por esta regra.
- **RN-20** — O `04-lgpd.md` ganha a finalidade "pedido de acesso ao portal" e o prazo da RN-19.

## 5. Contrato da API

| Rota                             | Papéis                        | Request                                      | Response / erros                                                           |
| -------------------------------- | ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /me`                        | qualquer autenticado          | —                                            | + `accessStatus`                                                           |
| `PATCH /me`                      | qualquer, inclusive `pending` | unidade e departamento (já existe)           | 403 `ACCESS_REJECTED` se recusado                                          |
| `GET /users/access-requests`     | `admin`                       | paginação                                    | lista da RN-10                                                             |
| `POST /users/:id/access/approve` | `admin`                       | `{ companyId, departmentId, isExternal? }`   | 200 usuário; 404 se não existe; 409 se já `approved`; 422 sem unidade/dep. |
| `POST /users/:id/access/reject`  | `admin`                       | `{ note? }` (até 500 caracteres, só interno) | 200; 404; 409 se já `rejected`                                             |
| Demais rotas autenticadas        | conforme hoje                 | —                                            | 403 `ACCESS_PENDING` / `ACCESS_REJECTED` (RN-06)                           |

Códigos novos em `ApiErrorCode`: `ACCESS_PENDING`, `ACCESS_REJECTED`. Removido: `EXTERNAL_USER_CANNOT_LOGIN` (RN-09). Schemas zod em `packages/shared`.

## 6. Dados

- `users`: `access_status` (enum `UserAccessStatus`: `pending | approved | rejected`, `NOT NULL`), `access_decided_by` (uuid, FK `users`, nulo), `access_decided_at` (timestamptz, nulo), `access_note` (text, nulo), `access_requested_at` (timestamptz, nulo: quando entrou na fila, RN-16).
- Migração nova: adiciona as colunas com default `approved` para as linhas existentes (RN-02) e depois troca o default da coluna para `pending` (RN-03).
- Índice parcial em `users(access_requested_at) WHERE access_status = 'pending'` para a fila.

## 7. Configuração

| Variável                        | Dev  | Produção | Uso   |
| ------------------------------- | ---- | -------- | ----- |
| `ACCESS_REQUEST_RETENTION_DAYS` | `90` | `90`     | RN-19 |

Zitadel e Google: nenhuma mudança além da P12 (consentimento Externo, auto-cadastro desligado).

## 8. Casos de borda

- Admin aprova e o usuário está com a tela aberta: a próxima chamada já passa (RN-15); a tela de espera consulta `GET /me` a cada 60 s e entra sozinha.
- Duas decisões simultâneas sobre o mesmo usuário: a segunda recebe 409 (transição condicionada ao status atual).
- Usuário recusado manda e-mail: vira ticket normalmente (canal de e-mail aberto). O agente vê o ticket e pode pedir ao admin para rever (RN-13).
- Agente recebe a role no Zitadel antes de ser aprovado: RN-04 aprova sozinho no próximo request.
- Pessoa sem conta Google (só e-mail corporativo de outra empresa no Outlook): não consegue entrar no portal; usa o e-mail. Documentar na tela de login? ⚠️ (§12).
- Unidade sugerida errada: o admin corrige no ato de aprovar (RN-11).

## 9. Casos de teste

| CT    | Dado                                                | Quando                                              | Então                                                                                  | Cobre        |
| ----- | --------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------ |
| CT-01 | Usuários existentes antes da migração               | Migração aplicada                                   | Todos `approved`                                                                       | RN-02        |
| CT-02 | Token válido de `sub` novo, sem role                | 1º request                                          | Usuário criado `pending`                                                               | RN-03        |
| CT-03 | Usuário `pending`                                   | `GET /tickets`, `POST /tickets`, `GET /tickets/:id` | 403 `ACCESS_PENDING`                                                                   | RN-06        |
| CT-04 | Usuário `pending`                                   | `GET /me`, `PATCH /me`, `GET /companies`            | 200                                                                                    | RN-06        |
| CT-05 | Usuário `rejected`                                  | `PATCH /me` e `GET /tickets`                        | 403 `ACCESS_REJECTED`; `GET /me` 200 com `accessStatus = rejected`                     | RN-06, RN-08 |
| CT-06 | Usuário `pending` com role `agente` no token        | Qualquer request                                    | Passa e fica `approved`, com log de aprovação automática                               | RN-04        |
| CT-07 | Usuário criado pelo e-mail com `is_external = true` | 1º login com o mesmo e-mail verificado              | Vinculado, `pending`, sem `EXTERNAL_USER_CANNOT_LOGIN`                                 | RN-09        |
| CT-08 | Três `pending` em datas diferentes                  | Admin `GET /users/access-requests`                  | Ordem do mais antigo, com unidade e departamento sugeridos                             | RN-10        |
| CT-09 | Usuário `pending`                                   | Admin aprova com outra unidade                      | `approved`, unidade trocada, decisor e data gravados; próxima request do usuário passa | RN-11, RN-15 |
| CT-10 | Usuário `pending`                                   | Admin aprova sem departamento                       | 422; continua `pending`                                                                | RN-11        |
| CT-11 | Usuário `pending`                                   | Admin recusa com nota                               | `rejected`; `GET /me` do usuário não expõe a nota                                      | RN-12        |
| CT-12 | Usuário `approved`                                  | Admin aprova de novo                                | 409                                                                                    | §5           |
| CT-13 | Solicitante, agente e supervisor                    | Rotas de liberação                                  | 403 `FORBIDDEN_ROLE` (matriz de permissões)                                            | §5           |
| CT-14 | Usuário completa o 1º acesso                        | `PATCH /me`                                         | Um e-mail para cada admin ativo na outbox; segundo `PATCH /me` não gera outro          | RN-16        |
| CT-15 | Admin aprova                                        | —                                                   | E-mail de liberação na outbox, sem `[#n]` e sem `email_message_refs`; recusa não gera  | RN-17, RN-18 |
| CT-16 | `pending` sem ticket há 91 dias; outro com ticket   | Cron de retenção                                    | O primeiro é excluído; o segundo fica                                                  | RN-19        |
| CT-17 | E-mail de remetente desconhecido                    | Processado pela T21                                 | Ticket criado como hoje; usuário `pending`                                             | RN-03        |

Front (Vitest + Testing Library): redireciona `pending` para "Aguardando liberação" e `rejected` para "Acesso não liberado"; fila do admin aprova e recusa; badge com a contagem.

## 10. Decisões tomadas na implementação

(preencher depois da sessão)

## 11. Impactos em documentos

- `CLAUDE.md`: a regra "usuários com `is_external = true` nunca fazem login" passa a "terceiros entram no portal só depois de liberados"; acrescentar a liberação nas regras de segurança.
- `01-escopo.md`: fluxos 2 e a linha de terceiros; matriz de permissões com o papel "pendente".
- `04-lgpd.md`: RN-19 e RN-20.
- `ambientes.md`: P12 resolvida quando a T22 estiver em produção.

## 12. Perguntas em aberto

1. ⚠️ `supervisor` também pode liberar acessos, ou só `admin`?
2. ⚠️ A tela de login deve avisar "use sua conta Google; sem conta Google, escreva para suporte@..."?
3. ⚠️ Prazo de retenção de pedidos não aprovados: 90 dias está bom?

## 13. Prompt sugerido para a sessão

```text
Leia docs/specs/T22-onboarding-liberacao.md e o ADR-011. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, a migração (com o SQL revisado), a ordem de implementação e como cada CT vira teste (incluindo as linhas novas na matriz de permissões). Aguarde minha aprovação.
```
