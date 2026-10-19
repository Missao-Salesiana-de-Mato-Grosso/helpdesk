# Spec T04–T05 — Autenticação, autorização e provisionamento JIT

> Status: pronta · Tarefas: T04 (guard e roles), T05 (JIT, `/me`, onboarding) · Depende de: T01, T03 · Define o contrato para: T06 (front OIDC), T16 (tela de 1º acesso) · Revisada em: 19/10/2026

## 1. Objetivo

Toda requisição à API é autenticada por um JWT emitido pelo Zitadel e validado localmente, sem chamada de rede por request. As roles (`admin`, `supervisor`, `agente`) vêm do token; quem não tem role é solicitante. O usuário local é criado ou vinculado automaticamente no primeiro acesso. Quem ainda não informou unidade e departamento é sinalizado para a tela de 1º acesso e bloqueado no resto da API.

## 2. Fora de escopo

- Tela de login: é o Login V2 hospedado pelo Zitadel. Configuração do IdP Google: infra, dia 2 (`02-identidade-zitadel.md`).
- A tela de 1º acesso em si (T16) e o front OIDC (T06). Esta spec define o que eles consomem (§11).
- Webhook de desativação de usuário (Fase 2). No MVP, a desativação chega pela expiração do token (1 h) ou pela flag `active` local.
- Escopo de visibilidade de tickets: spec T08–T10. Aqui só se decide **quem é** o usuário e **qual papel** tem.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                                                                                                                                                                  | Fonte | Confirmar?                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O access token só é JWT se a aplicação no Zitadel tiver _Auth Token Type = JWT_. Com o padrão (Bearer opaco) nada aqui funciona                                                                                                                                       | 📘    | Checklist do dia 2                                                                                                                                                  |
| O access token JWT contém `sub`, `iss`, `aud`, `azp`, `exp`, `iat`, `nbf`, `jti` e os claims reservados do Zitadel. **Não contém `email` nem `name`.** Esses vêm de `GET {issuer}/oidc/v1/userinfo`, chamado com o próprio access token                               | 📘    | —                                                                                                                                                                   |
| Roles: claim `urn:zitadel:iam:org:project:{PROJECT_ID}:roles`, com formato `{ "agente": { "<orgId>": "<orgDomain>" } }`. Aparece quando o escopo `urn:zitadel:iam:org:projects:roles` é pedido ou quando a asserção de roles no access token está ligada na aplicação | 📘    | ⚠️ A documentação mostra um exemplo envolto em array (`[ { ... } ]`). O código aceita objeto **ou** array com um objeto. Confirmar com um token real e colar em §10 |
| Organização do usuário: claim `urn:zitadel:iam:user:resourceowner:id`, presente quando o escopo `urn:zitadel:iam:user:resourceowner` é pedido                                                                                                                         | 📘    | —                                                                                                                                                                   |
| `aud` inclui o `PROJECT_ID` quando o escopo `urn:zitadel:iam:org:project:id:{PROJECT_ID}:aud` é pedido. Pode vir como string ou array                                                                                                                                 | 📘    | —                                                                                                                                                                   |
| JWKS em `{issuer}/oauth/v2/keys`. `jose` faz cache e refetch automático quando aparece um `kid` desconhecido                                                                                                                                                          | 📘    | —                                                                                                                                                                   |
| `sub` é o ID numérico do usuário no Zitadel, estável, como string                                                                                                                                                                                                     | 📘    | —                                                                                                                                                                   |

**Checklist do dia 2 no console do Zitadel**, antes da sessão: aplicação com _Auth Token Type = JWT_ ✔ · opção de roles no access token ✔ · redirect URIs de prod e de dev ✔ · fazer um login real, decodificar o access token (ex.: `jose` decode ou jwt.io) e colar os claims em §10.

## 4. Regras de negócio

### Autenticação (T04)

- **RN-01** — Toda rota é protegida por um guard global. Rotas marcadas com `@Public()` dispensam token. Não existe rota "sem decoração e aberta".
- **RN-02** — O token vem em `Authorization: Bearer <jwt>`. Ausente ou malformado → `401 AUTH_MISSING`.
- **RN-03** — O token é válido quando: assinatura verificada contra o JWKS de `ZITADEL_ISSUER`; `iss === ZITADEL_ISSUER`; `aud` (string ou array) contém `ZITADEL_PROJECT_ID`; `exp` no futuro e `nbf`/`iat` no passado, com tolerância de `AUTH_CLOCK_TOLERANCE_SECONDS`. Qualquer falha → `401 AUTH_INVALID`, sem detalhar o motivo no corpo (o motivo vai para o log em nível `debug`).
- **RN-04** — Se o JWKS não puder ser obtido e não houver cache → `503 AUTH_UNAVAILABLE`. Com cache, a validação segue normalmente mesmo com o Zitadel fora do ar.
- **RN-05** — Roles = chaves do claim `urn:zitadel:iam:org:project:${ZITADEL_PROJECT_ID}:roles` (objeto, ou array com um objeto) filtradas por `{admin, supervisor, agente}`. Claim ausente, vazio ou só com chaves desconhecidas → `[]` (solicitante). Fallback: se o claim específico não existir mas `urn:zitadel:iam:org:project:roles` existir, usar este.
- **RN-06** — Se `ZITADEL_ORG_ID` estiver configurado, o claim `urn:zitadel:iam:user:resourceowner:id` precisa ser igual a ele → senão `403 WRONG_ORGANIZATION`. Se a variável estiver vazia, a checagem é pulada (instância dedicada).
- **RN-07** — `@Roles('a', 'b')` exige **ao menos uma** das roles. Usuário autenticado sem nenhuma → `403 FORBIDDEN_ROLE`. Atalho: `isAgent = roles ∩ {agente, supervisor, admin} ≠ ∅`.
- **RN-08** — O guard monta `CurrentUser = { id, zitadelSub, email, name, roles, isAgent, companyId, departmentId, groupIds, needsOnboarding }` e o disponibiliza por `@CurrentUser()`. Controllers e services nunca leem o token diretamente.

### Provisionamento JIT (T05)

- **RN-09** — Após validar o token, o guard resolve o usuário local por `zitadel_sub`, com cache em memória por `sub` (TTL `AUTH_CACHE_TTL_SECONDS`, padrão 60 s). Cache hit não toca o banco.
- **RN-10** — Cache miss e usuário **não existe** por `zitadel_sub`:
  1. Buscar `name` e `email` em `GET {ZITADEL_ISSUER}/oidc/v1/userinfo` com o access token. Falha → `503 AUTH_UNAVAILABLE` (não criar usuário sem e-mail).
  2. Se existir usuário com o mesmo `email` (comparação case-insensitive) e `zitadel_sub = null` e `is_external = false` → **vincular**: gravar `zitadel_sub`, atualizar `name`, `profile_synced_at = now()`.
  3. Se existir usuário com o mesmo `email` e `is_external = true` → `403 EXTERNAL_USER_CANNOT_LOGIN` e log em `warn`. O admin corrige a marcação (T15). Não vincular automaticamente.
  4. Se existir usuário com o mesmo `email` e `zitadel_sub` **diferente** e não nulo → `403 WRONG_ORGANIZATION` e log em `error` (indica conta duplicada no Zitadel; precisa de intervenção).
  5. Senão → **criar**: `zitadel_sub`, `email`, `name`, `roles` (do token), `active = true`, `is_external = false`, `company_id = null`, `department_id = null`, `last_login_at = now()`, `profile_synced_at = now()`.
- **RN-11** — Cache miss e usuário **existe**: se `roles` do token ≠ `roles` gravadas → atualizar. Se `last_login_at` for anterior a 1 h → atualizar para `now()`. Se `profile_synced_at` for anterior a 24 h → chamar `userinfo` e atualizar `name` e `email`; se o novo e-mail colidir com outro usuário → manter o antigo e logar `warn`. Falha no `userinfo` nessa resincronização **não** bloqueia a requisição.
- **RN-12** — `active = false` → `403 USER_INACTIVE`, mesmo com token válido. Essa é a forma de corte imediato no MVP.
- **RN-13** — `needsOnboarding = (company_id == null || department_id == null)`. Vale para todos, inclusive agentes e admins.
- **RN-14** — Enquanto `needsOnboarding`, só são permitidas rotas marcadas com `@AllowDuringOnboarding()`: `GET /api/me`, `PATCH /api/me`, `GET /api/companies`, `GET /api/departments`. Qualquer outra → `403 ONBOARDING_REQUIRED`.
- **RN-15** — `PATCH /api/me` aceita apenas `companyId` e `departmentId`, ambos obrigatórios, referenciando registros ativos. Depois da gravação, invalida a entrada do cache do usuário. Qualquer outro campo no corpo → `422 VALIDATION_ERROR`.
- **RN-16** — Testes nunca dependem do Zitadel: o provedor de JWKS e o cliente de `userinfo` são injetáveis. A suíte usa um par de chaves RSA gerado em memória, um `TestTokenFactory` que assina tokens com claims configuráveis e um `userinfo` falso.

## 5. Contrato da API

Formato de erro em toda a API: `{ "statusCode": 403, "code": "ONBOARDING_REQUIRED", "message": "Informe unidade e departamento para continuar." }`. Respostas 401 levam o header `WWW-Authenticate: Bearer`.

Códigos novos em `ApiErrorCode`: `AUTH_MISSING`, `AUTH_INVALID`, `AUTH_UNAVAILABLE`, `WRONG_ORGANIZATION`, `FORBIDDEN_ROLE`, `USER_INACTIVE`, `EXTERNAL_USER_CANNOT_LOGIN`, `ONBOARDING_REQUIRED`, `VALIDATION_ERROR`.

### `GET /api/me` — autenticado, permitido durante o onboarding

```json
{
  "id": "uuid",
  "name": "Maria Silva",
  "email": "maria@missaosalesiana.org.br",
  "roles": ["agente"],
  "isAgent": true,
  "company": { "id": "uuid", "name": "Colégio Salesiano Cuiabá" },
  "department": { "id": "uuid", "name": "Secretaria" },
  "groups": [{ "id": "uuid", "name": "Suporte TI" }],
  "needsOnboarding": false
}
```

`company` e `department` vêm `null` até o onboarding. `groups` vem `[]` para quem não é agente.

### `PATCH /api/me` — autenticado, permitido durante o onboarding

Request: `{ "companyId": "uuid", "departmentId": "uuid" }`. Response: igual ao `GET /api/me`. Erros: `422 VALIDATION_ERROR` (campo faltando, extra, ou referência inexistente/inativa).

### `GET /api/companies` e `GET /api/departments` — autenticado, permitido durante o onboarding

Lista de `{ id, name }` dos registros com `active = true`, ordenada por nome. Sem paginação (dezenas de registros).

### `GET /api/health` — `@Public()`

Já existente (terminus). Serve de prova de que `@Public()` funciona.

## 6. Dados

Tabela `users` (criada em T03). Esta spec exige que existam: `zitadel_sub text unique null`, `email citext unique not null`, `name text not null`, `roles text[] not null default '{}'`, `active bool not null default true`, `is_external bool not null default false`, `company_id uuid null`, `department_id uuid null`, `last_login_at timestamptz null`, **`profile_synced_at timestamptz null`** (adicionar se T03 não criou), `created_at`, `updated_at`.

Índices: `users(zitadel_sub)` único parcial onde não nulo; `users(email)` único (citext).

## 7. Configuração

| Variável                       | Dev                       | Produção                   | Uso                            |
| ------------------------------ | ------------------------- | -------------------------- | ------------------------------ |
| `ZITADEL_ISSUER`               | `http://localhost:8080`   | `https://auth.msmt.org.br` | `iss`, JWKS, `userinfo`        |
| `ZITADEL_PROJECT_ID`           | id do projeto local       | id do projeto de produção  | `aud` e nome do claim de roles |
| `ZITADEL_ORG_ID`               | vazio                     | id da org da Missão        | RN-06 (opcional)               |
| `AUTH_CLOCK_TOLERANCE_SECONDS` | `60`                      | `60`                       | RN-03                          |
| `AUTH_CACHE_TTL_SECONDS`       | `60`                      | `60`                       | RN-09                          |
| `VITE_ZITADEL_AUTHORITY`       | `http://localhost:8080`   | `https://auth.msmt.org.br` | front (§11)                    |
| `VITE_ZITADEL_CLIENT_ID`       | client id da app local    | client id de produção      | front (§11)                    |
| `VITE_ZITADEL_PROJECT_ID`      | idem `ZITADEL_PROJECT_ID` | idem                       | escopos do front (§11)         |

## 8. Casos de borda

| Situação                                                                                  | Comportamento                                                                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `aud` vem como string única igual ao `PROJECT_ID`                                         | Válido (RN-03 aceita string ou array)                                                                                      |
| Token de outra aplicação do mesmo projeto (ex.: app mobile no futuro)                     | Válido: o que importa é o projeto no `aud`                                                                                 |
| `kid` desconhecido                                                                        | `jose` refaz o fetch do JWKS uma vez; se continuar desconhecido → `401 AUTH_INVALID`                                       |
| Relógio do pod adiantado 30 s                                                             | Tolerância de 60 s cobre                                                                                                   |
| Zitadel fora do ar, usuário já em cache de JWKS                                           | Requisições continuam funcionando até o token expirar                                                                      |
| Zitadel fora do ar, primeiro acesso de um usuário novo (precisa de `userinfo`)            | `503 AUTH_UNAVAILABLE`. O front mostra "autenticação temporariamente indisponível"                                         |
| Usuário muda de nome no Google                                                            | Reflete em até 24 h (RN-11) ou no próximo login se o cache do Zitadel for mais rápido. Aceitável                           |
| Role concedida ou removida no Zitadel                                                     | Reflete no próximo refresh do token (≤ 1 h) e, na API, no próximo cache miss (≤ 60 s depois disso)                         |
| Claim de roles com org diferente dentro do objeto (`{ "agente": { "<outraOrg>": ... } }`) | Ignorado neste MVP: roles são lidas pelas chaves. Com `ZITADEL_ORG_ID` configurado, a RN-06 já barra usuários de outra org |
| Terceiro cadastrado por e-mail tenta logar com conta Google institucional                 | `403 EXTERNAL_USER_CANNOT_LOGIN`. Significa que a marcação está errada: admin corrige                                      |
| Dois usuários locais com e-mails que diferem só em maiúsculas                             | Impossível: `email` é `citext` único                                                                                       |
| Requisição com token válido de usuário inativo que ainda está em cache                    | O cache guarda `active`; `PATCH /users/:id` (T15) invalida a entrada. Entre réplicas, vale o TTL de 60 s                   |

## 9. Casos de teste

| CT    | Dado                                                                         | Quando                                                 | Então                                                                                   | Cobre          |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------- |
| CT-01 | Rota sem `@Public()`                                                         | Request sem `Authorization`                            | 401 `AUTH_MISSING` + `WWW-Authenticate`                                                 | RN-01, RN-02   |
| CT-02 | `GET /api/health`                                                            | Request sem token                                      | 200                                                                                     | RN-01          |
| CT-03 | Token assinado com chave que não está no JWKS                                | Request                                                | 401 `AUTH_INVALID`, corpo sem detalhes                                                  | RN-03          |
| CT-04 | Token com `exp` 5 min no passado                                             | Request                                                | 401 `AUTH_INVALID`                                                                      | RN-03          |
| CT-05 | Token com `exp` 30 s no passado                                              | Request                                                | 200 (tolerância)                                                                        | RN-03          |
| CT-06 | Token com `aud = ["outro-projeto"]`                                          | Request                                                | 401 `AUTH_INVALID`                                                                      | RN-03          |
| CT-07 | Token com `aud` string igual ao projeto                                      | Request                                                | 200                                                                                     | RN-03, §8      |
| CT-08 | Token com `iss` diferente                                                    | Request                                                | 401 `AUTH_INVALID`                                                                      | RN-03          |
| CT-09 | JWKS indisponível e sem cache                                                | Request                                                | 503 `AUTH_UNAVAILABLE`                                                                  | RN-04          |
| CT-10 | Claim de roles `{ "agente": {...}, "foo": {...} }`                           | `GET /api/me`                                          | `roles = ["agente"]`, `isAgent = true`                                                  | RN-05          |
| CT-11 | Claim de roles como array `[ { "admin": {...} } ]`                           | `GET /api/me`                                          | `roles = ["admin"]`                                                                     | RN-05          |
| CT-12 | Sem claim de roles                                                           | `GET /api/me`                                          | `roles = []`, `isAgent = false`                                                         | RN-05          |
| CT-13 | `ZITADEL_ORG_ID` configurado, claim `resourceowner:id` diferente             | Request                                                | 403 `WRONG_ORGANIZATION`                                                                | RN-06          |
| CT-14 | Rota com `@Roles('supervisor')`, usuário `agente`                            | Request                                                | 403 `FORBIDDEN_ROLE`                                                                    | RN-07          |
| CT-15 | Rota com `@Roles('agente','supervisor')`, usuário `supervisor`               | Request                                                | 200                                                                                     | RN-07          |
| CT-16 | `sub` inexistente; `userinfo` falso devolve nome e e-mail novos              | `GET /api/me`                                          | Usuário criado com `company = null`, `needsOnboarding = true`; `userinfo` chamado 1 vez | RN-10.5, RN-13 |
| CT-17 | Usuário local com mesmo e-mail, `zitadel_sub = null`, `is_external = false`  | `GET /api/me` com `sub` novo                           | Registro vinculado (mesmo `id`), `zitadel_sub` gravado                                  | RN-10.2        |
| CT-18 | Usuário local com mesmo e-mail e `is_external = true`                        | `GET /api/me`                                          | 403 `EXTERNAL_USER_CANNOT_LOGIN`; nenhum registro alterado                              | RN-10.3        |
| CT-19 | Usuário local com mesmo e-mail e outro `zitadel_sub`                         | `GET /api/me`                                          | 403 `WRONG_ORGANIZATION`                                                                | RN-10.4        |
| CT-20 | `userinfo` falha no 1º acesso                                                | `GET /api/me`                                          | 503 `AUTH_UNAVAILABLE`; nenhum usuário criado                                           | RN-10.1        |
| CT-21 | Usuário existente com `roles = []`; token traz `agente`                      | Request após expirar o cache                           | `roles` atualizadas no banco                                                            | RN-11          |
| CT-22 | Usuário existente, `profile_synced_at` há 25 h, `userinfo` devolve nome novo | Request                                                | Nome atualizado; `userinfo` chamado 1 vez                                               | RN-11          |
| CT-23 | Mesmo que CT-22, mas `userinfo` falha                                        | Request                                                | 200; nome antigo mantido; log `warn`                                                    | RN-11          |
| CT-24 | Dois requests seguidos do mesmo `sub` dentro do TTL                          | Requests                                               | Banco consultado 1 vez (spy no repositório)                                             | RN-09          |
| CT-25 | Usuário `active = false`                                                     | Request                                                | 403 `USER_INACTIVE`                                                                     | RN-12          |
| CT-26 | Usuário sem unidade                                                          | `GET /api/tickets`                                     | 403 `ONBOARDING_REQUIRED`                                                               | RN-14          |
| CT-27 | Usuário sem unidade                                                          | `GET /api/companies`                                   | 200                                                                                     | RN-14          |
| CT-28 | Usuário sem unidade                                                          | `PATCH /api/me` com unidade e departamento ativos      | 200, `needsOnboarding = false`; próximo `GET /api/tickets` não dá 403                   | RN-15, RN-14   |
| CT-29 | —                                                                            | `PATCH /api/me` com `departmentId` de registro inativo | 422 `VALIDATION_ERROR`                                                                  | RN-15          |
| CT-30 | —                                                                            | `PATCH /api/me` com campo extra `name`                 | 422 `VALIDATION_ERROR`                                                                  | RN-15          |
| CT-31 | Agente com 2 grupos                                                          | `GET /api/me`                                          | `groups` com os 2; `company` e `department` preenchidos                                 | RN-08          |

## 10. Claims reais (preencher no dia 2)

```json
// Colar aqui o payload decodificado de um access token real do ambiente de produção,
// com valores sensíveis mascarados. Serve de fixture para os testes.
```

## 11. Contrato para o front (T06)

Configuração do `oidc-client-ts` / `react-oidc-context`:

```ts
{
  authority: import.meta.env.VITE_ZITADEL_AUTHORITY,
  client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',            // Authorization Code + PKCE (padrão da lib)
  scope: [
    'openid', 'profile', 'email', 'offline_access',
    `urn:zitadel:iam:org:project:id:${PROJECT_ID}:aud`,
    'urn:zitadel:iam:org:projects:roles',
    'urn:zitadel:iam:user:resourceowner',
  ].join(' '),
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
}
```

Comportamento do front com os códigos desta spec: `401` → inicia `signinRedirect()`; `403 ONBOARDING_REQUIRED` ou `needsOnboarding = true` no `/me` → rota `/primeiro-acesso` (T16); `403 USER_INACTIVE` / `EXTERNAL_USER_CANNOT_LOGIN` / `WRONG_ORGANIZATION` → página "sem acesso" com a mensagem do erro e botão de logout; `503 AUTH_UNAVAILABLE` → aviso e botão "tentar de novo".

## 12. Decisões tomadas na implementação

_(preencher após a sessão)_

## 13. Prompt sugerido para a sessão

```text
Leia docs/specs/T04-T05-auth-jit.md e o CLAUDE.md. Vamos implementar T04 e T05 (módulo auth, /me, /companies, /departments, onboarding gate).

Antes de escrever código, apresente um plano com:
1. arquivos a criar ou alterar (módulo auth: guard global, decorators @Public/@Roles/@AllowDuringOnboarding/@CurrentUser, provedor de JWKS injetável, cliente de userinfo injetável, cache em memória, serviço de JIT; módulos users/companies/departments mínimos; enum ApiErrorCode em packages/shared);
2. a ordem de implementação;
3. como cada CT (CT-01 a CT-31) vira um teste, com o helper TestTokenFactory (par de chaves RSA em memória) e o userinfo falso.

Aguarde minha aprovação do plano. Depois implemente, nomeando cada teste com o identificador do CT. Ao final, rode pnpm typecheck, pnpm lint e pnpm test, e me mostre o resultado.
```
