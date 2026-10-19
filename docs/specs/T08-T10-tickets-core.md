# Spec T08–T10 — Tickets: criação, leitura, atualização e mensagens

> Status: pronta · Tarefas: T08 (criar e ler), T09 (atualizar), T10 (mensagens) · Depende de: T03, T04–T05 · Consumida por: T11, T12 (front), T13 (anexos), T14 (notificações), T21 (e-mail) · Revisada em: 19/10/2026

## 1. Objetivo

O núcleo do atendimento: solicitantes abrem e acompanham tickets; agentes veem as filas dos seus grupos, assumem, respondem, anotam internamente e mudam status, prioridade, grupo, responsável, categoria e unidade. Cada ticket tem uma conversa (mensagens públicas e notas internas) e um histórico de eventos. A regra de quem vê o quê é aplicada **no repositório**, nunca só na tela.

## 2. Fora de escopo

- Anexos (T13): esta spec só reserva `attachments: []` nas respostas.
- Envio de e-mails (T14): esta spec **emite eventos de domínio**; T14 os assina.
- Chegada de tickets por e-mail (T21): usa os mesmos services desta spec com `source = email` e `via = email`. Esta spec garante que os services aceitam um "ator do sistema".
- Busca full-text, SLA, automações, merge, campos customizados: Fase 2.
- Telas (T11, T12).

## 3. Fatos externos que esta spec assume

| Fato                                                                                                        | Fonte | Confirmar?                |
| ----------------------------------------------------------------------------------------------------------- | ----- | ------------------------- |
| `CurrentUser` com `id`, `roles`, `isAgent`, `groupIds`, `companyId` já vem do guard (spec T04–T05)          | 💡    | —                         |
| Seed de T03 criou grupos, categorias (todas com `default_group_id`), unidades e departamentos               | 💡    | Verificar antes da sessão |
| `sanitize-html` é a biblioteca de sanitização; `@nestjs/event-emitter` é o barramento de eventos de domínio | 💡    | —                         |

## 4. Regras de negócio

### Escopo de visibilidade

- **RN-01** — Existe uma única função `ticketScope(user): Prisma.TicketWhereInput` usada por **todas** as leituras e escritas do repositório de tickets:
  - sem role (solicitante): `requester_id = user.id`
  - `agente`: `requester_id = user.id OR assignee_id = user.id OR group_id IN user.groupIds`
  - `supervisor` ou `admin`: sem restrição
- **RN-02** — Ticket fora do escopo → `404 NOT_FOUND`, idêntico a ticket inexistente. Ticket no escopo mas ação não permitida ao papel → `403 FORBIDDEN_ROLE`.
- **RN-03** — Controllers nunca chamam o Prisma. Services recebem `CurrentUser` (ou o ator do sistema `SYSTEM_ACTOR` para T21) e delegam ao repositório, que aplica a RN-01.

### Criação (T08)

- **RN-04** — `POST /api/tickets` aceita `subject` (3–200 caracteres após `trim`), `bodyHtml` (até 100 KB brutos), `categoryId`, e opcionalmente `priority` (padrão `medium`), `companyId`, `requesterId` (só agente+), `relatedTicketId`.
- **RN-05** — Solicitante do ticket: `requesterId` se informado por agente+, senão o usuário atual. Solicitante sem role que envie `requesterId` → `403 FORBIDDEN_ROLE`. `requesterId` precisa existir (pode ser terceiro).
- **RN-06** — `source`: `portal` quando o solicitante é o próprio criador; `agent` quando um agente cria em nome de outro; `email` reservado a T21.
- **RN-07** — Unidade do ticket: `companyId` do corpo, senão `company_id` do solicitante. Se o resultado for nulo e o criador **não** for agente → `422 COMPANY_REQUIRED`. Agente pode criar sem unidade (triagem depois).
- **RN-08** — Grupo do ticket = `default_group_id` da categoria. Categoria, unidade ou grupo inativos ou inexistentes → `422 INACTIVE_REFERENCE`.
- **RN-09** — `number` vem da sequência `tickets_number_seq`, que começa em **1001**. Exibido como `#1001`.
- **RN-10** — A criação grava, na mesma transação: o ticket (`status = open`, `version = 1`), a primeira mensagem (`kind = public`, `via = portal`, autor = criador, corpo sanitizado), o evento `created` (com `relatedTicketId` em `data` se houver) e emite o evento de domínio `ticket.created`.
- **RN-11** — `relatedTicketId`, se informado, precisa estar no escopo do **solicitante** do novo ticket; senão `404 NOT_FOUND`. Serve para "abrir novo chamado a partir de um fechado".

### Listagem e detalhe (T08)

- **RN-12** — `GET /api/tickets` aceita `view`, `status[]`, `priority[]`, `companyId`, `noCompany`, `groupId`, `q`, `page`, `pageSize`, `sort`. Tudo é aplicado **por cima** da RN-01.
- **RN-13** — Views: `requested` (solicitante = eu; disponível a todos), `mine` (responsável = eu), `group` (grupo ∈ meus grupos), `unassigned` (sem responsável; para agente, limitado aos meus grupos; para supervisor+, todos), `all` (só a RN-01). Solicitante sem role só pode usar `requested`; outra view → `403 FORBIDDEN_ROLE`. Padrão: solicitante → `requested`; agente → `group`; supervisor/admin → `all`.
- **RN-14** — `status[]` padrão: `open,pending` para views de agente (`mine`, `group`, `unassigned`, `all`); todos os status para `requested`.
- **RN-15** — `q`: se casar com `^#?\d+$` → `number` igual; senão (mínimo 2 caracteres) → `subject ILIKE %q%`. Menos de 2 caracteres não numéricos → ignorar o filtro.
- **RN-16** — `noCompany = true` → `company_id IS NULL`. Tem precedência sobre `companyId`.
- **RN-17** — Paginação: `page ≥ 1`, `pageSize` 1–100 (padrão 25). `sort`: `updated_at:desc` (padrão), `created_at:asc|desc`, `priority:desc`, `number:asc|desc`. Resposta: `{ items, total, page, pageSize }`.
- **RN-18** — `GET /api/tickets/counters` (agente+) devolve, dentro da RN-01 e com `status ∈ {open, pending}`: `{ mine, group, unassigned, noCompany }`. Solicitante → `403 FORBIDDEN_ROLE`.
- **RN-19** — `GET /api/tickets/:id` devolve o ticket, solicitante, responsável, grupo, categoria, unidade, as mensagens em ordem cronológica e os eventos em ordem cronológica. Para quem **não** é agente: mensagens `internal` são omitidas e eventos `message_added` com `data.kind = internal` também. A omissão é feita na query, não depois de carregar.
- **RN-20** — `quoted_html` das mensagens é devolvido; o front o exibe recolhido. Mensagens têm `attachments: []` (preenchido por T13).

### Atualização (T09)

- **RN-21** — `PATCH /api/tickets/:id` é só para agente+ (solicitante → `403 FORBIDDEN_ROLE`). Corpo: `version` (obrigatório) e, opcionais, `status`, `priority`, `groupId`, `assigneeId` (ou `null` para desatribuir), `categoryId`, `companyId`, `applyCompanyToRequester`.
- **RN-22** — `version` diferente da atual → `409 VERSION_CONFLICT`, corpo `{ ..., "currentVersion": n }`. Nada é gravado. Sucesso incrementa `version` em 1.
- **RN-23** — Transições de status permitidas pelo `PATCH`: `open → pending | resolved | closed`; `pending → open | resolved | closed`; `resolved → open | closed`. Ticket `closed` não aceita nenhuma alteração → `422 TICKET_CLOSED`. Outra transição → `422 INVALID_TRANSITION`.
- **RN-24** — Ir para `resolved` ou `closed` exige `company_id` não nulo (considerando o `companyId` do mesmo corpo) → senão `422 COMPANY_REQUIRED`.
- **RN-25** — `resolved_at = now()` ao entrar em `resolved`; volta a `null` ao reabrir (`resolved → open`). `closed_at = now()` ao entrar em `closed`.
- **RN-26** — `assigneeId` precisa ser usuário ativo com role `agente`, `supervisor` ou `admin` **e** membro do grupo do ticket (considerando o `groupId` do mesmo corpo) → senão `422 ASSIGNEE_NOT_IN_GROUP`. Supervisor e admin estão dispensados de pertencer ao grupo. "Assumir" é `assigneeId = eu` e segue a mesma regra.
- **RN-27** — Um agente pode mover o ticket para qualquer grupo ativo, inclusive um ao qual não pertence. Depois disso, deixa de vê-lo (RN-01), o que é o esperado.
- **RN-28** — `companyId` com `applyCompanyToRequester = true` também grava a unidade no solicitante. Sem a flag, grava só no ticket. Se o solicitante não tem unidade e a flag veio ausente, o comportamento é só no ticket; o front decide quando oferecer a flag.
- **RN-29** — Cada campo efetivamente alterado gera um `ticket_events` com `type` específico (`status_changed`, `priority_changed`, `assigned`, `group_changed`, `category_changed`, `company_changed`) e `data = { from, to }`. Campo enviado com o mesmo valor atual não gera evento. Tudo na mesma transação. Eventos de domínio: `ticket.status_changed`, `ticket.assigned` (quando o responsável muda), `ticket.updated` (sempre).
- **RN-30** — Resposta do `PATCH`: o mesmo payload do `GET /api/tickets/:id`.

### Mensagens (T10)

- **RN-31** — `POST /api/tickets/:id/messages` aceita `kind` (`public` | `internal`), `bodyHtml` (até 100 KB), e, para agente+, opcionalmente `status` + `version` ("responder e marcar como…").
- **RN-32** — Solicitante sem role: só `kind = public` (senão `403 FORBIDDEN_ROLE`) e só em tickets do seu escopo (RN-01).
- **RN-33** — `bodyHtml` passa por `sanitize-html` com a allowlist de §7 antes de gravar. Se, após sanitizar, o texto (sem tags, `trim`) ficar vazio → `422 EMPTY_BODY`.
- **RN-34** — Mensagem em ticket `closed` → `422 TICKET_CLOSED`. O front oferece "abrir novo chamado relacionado" (RN-11).
- **RN-35** — Mensagem `public` de um **agente que não é o solicitante** do ticket: se `first_response_at` for nulo → `first_response_at = now()`. Status não muda sozinho; muda só se `status` vier no corpo (RN-36).
- **RN-36** — `status` no corpo (agente+): exige `version`; aplica RN-22, RN-23, RN-24, RN-25 na mesma transação da mensagem. `status` sem `version` → `422 VALIDATION_ERROR`.
- **RN-37** — Mensagem `public` do **solicitante** do ticket (inclusive um agente respondendo ao próprio chamado): `pending → open`; `resolved → open` com `resolved_at = null` e evento `status_changed` com `data.reason = "requester_reply"`. Em `open`, nada muda.
- **RN-38** — Mensagem `internal`: nunca altera status nem `first_response_at`.
- **RN-39** — Toda mensagem grava `via = portal`, o evento `message_added` com `data = { messageId, kind }`, atualiza `tickets.updated_at` e emite o evento de domínio `ticket.message_added` com `{ ticketId, messageId, kind, authorId, authorIsRequester }`.
- **RN-40** — `ticket_events` recebe `actor_id` (usuário atual ou `SYSTEM_ACTOR`) e `ip` (primeiro valor de `X-Forwarded-For`, com `trust proxy = 1`, senão o IP do socket).

## 5. Contrato da API

Códigos novos em `ApiErrorCode`: `NOT_FOUND`, `VERSION_CONFLICT`, `TICKET_CLOSED`, `INVALID_TRANSITION`, `COMPANY_REQUIRED`, `ASSIGNEE_NOT_IN_GROUP`, `INACTIVE_REFERENCE`, `EMPTY_BODY`.

Schemas zod em `packages/shared/src/tickets.ts`: `TicketStatus`, `TicketPriority`, `TicketSource`, `MessageKind`, `CreateTicketSchema`, `ListTicketsQuerySchema`, `UpdateTicketSchema`, `CreateMessageSchema`, e os tipos de resposta `TicketSummary`, `TicketDetail`, `TicketMessage`, `TicketEvent`, `TicketCounters`.

### `POST /api/tickets` — autenticado

```json
// request
{
  "subject": "Impressora da secretaria não imprime",
  "bodyHtml": "<p>Desde ontem...</p>",
  "categoryId": "uuid",
  "priority": "medium",
  "companyId": "uuid",
  "requesterId": "uuid",
  "relatedTicketId": "uuid"
}
// response 201: TicketDetail (igual ao GET /api/tickets/:id)
```

### `GET /api/tickets` — autenticado

Query: `view=requested|mine|group|unassigned|all`, `status=open&status=pending`, `priority=`, `companyId=`, `noCompany=true`, `groupId=`, `q=`, `page=1`, `pageSize=25`, `sort=updated_at:desc`.

```json
{
  "items": [
    {
      "id": "uuid",
      "number": 1001,
      "subject": "...",
      "status": "open",
      "priority": "high",
      "requester": { "id": "uuid", "name": "...", "isExternal": false },
      "assignee": { "id": "uuid", "name": "..." },
      "group": { "id": "uuid", "name": "..." },
      "company": null,
      "category": { "id": "uuid", "name": "..." },
      "createdAt": "...",
      "updatedAt": "...",
      "lastMessageAt": "..."
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 25
}
```

### `GET /api/tickets/counters` — agente+

```json
{ "mine": 3, "group": 12, "unassigned": 4, "noCompany": 2 }
```

### `GET /api/tickets/:id` — escopo

```json
{ "id": "uuid", "number": 1001, "subject": "...", "status": "open", "priority": "medium", "source": "portal", "version": 3,
  "requester": { "id": "uuid", "name": "...", "email": "...", "isExternal": false, "company": {...}, "department": {...} },
  "assignee": { "id": "uuid", "name": "..." }, "group": {...}, "category": {...}, "company": {...},
  "firstResponseAt": null, "resolvedAt": null, "closedAt": null, "createdAt": "...", "updatedAt": "...",
  "messages": [ { "id": "uuid", "kind": "public", "via": "portal", "bodyHtml": "...", "quotedHtml": null,
                  "author": { "id": "uuid", "name": "...", "isAgent": false }, "attachments": [], "createdAt": "..." } ],
  "events": [ { "id": 1, "type": "created", "actor": { "id": "uuid", "name": "..." }, "data": {}, "createdAt": "..." } ] }
```

### `PATCH /api/tickets/:id` — agente+

```json
// request
{
  "version": 3,
  "status": "pending",
  "priority": "high",
  "groupId": "uuid",
  "assigneeId": "uuid",
  "categoryId": "uuid",
  "companyId": "uuid",
  "applyCompanyToRequester": true
}
// response 200: TicketDetail · 409: { "statusCode": 409, "code": "VERSION_CONFLICT", "message": "...", "currentVersion": 4 }
```

### `POST /api/tickets/:id/messages` — escopo

```json
// request
{
  "kind": "public",
  "bodyHtml": "<p>Já verifiquei o cabo...</p>",
  "status": "pending",
  "version": 3
}
// response 201: TicketDetail
```

## 6. Dados

Já criados em T03; esta spec exige:

- `tickets`: `number bigint unique` (default `nextval('tickets_number_seq')`, sequência iniciando em 1001), `status`, `priority`, `source`, `requester_id`, `assignee_id null`, `group_id`, `category_id`, `company_id null`, `version int default 1`, `first_response_at`, `resolved_at`, `closed_at`, `created_at`, `updated_at`.
- `ticket_messages`: `kind`, `via` (`portal|email`), `body_html`, `quoted_html null`, `author_id`, `created_at`.
- `ticket_events`: `id bigserial`, `ticket_id`, `actor_id`, `type text`, `data jsonb`, `ip inet null`, `created_at`. **Append-only**: nenhum método de repositório faz update ou delete nela.
- `categories.default_group_id` **NOT NULL** (ajustar migração se T03 deixou nulo).
- Índices: `tickets(status, group_id)`, `tickets(assignee_id, status)`, `tickets(requester_id)`, `tickets(company_id, status)`, `tickets(updated_at desc)`, `ticket_messages(ticket_id, created_at)`, `ticket_events(ticket_id, created_at)`.
- Ator do sistema: usuário seedado `system@helpdesk.local` com `active = false`, `is_external = false`, usado como `actor_id` por T21 e jobs. Nunca autentica (RN-12 da spec anterior).

## 7. Sanitização de HTML (allowlist)

- Tags: `p, br, div, span, b, strong, i, em, u, s, a, ul, ol, li, blockquote, pre, code, h1, h2, h3, h4, hr, table, thead, tbody, tr, th, td, img`.
- Atributos: `a[href, title]`; `img[src, alt, width, height]`; `td/th[colspan, rowspan]`. Nenhum `style`, `class`, `id` ou `on*`.
- Esquemas: `a` → `http, https, mailto`; `img` → `http, https` (imagens `cid:` são removidas no MVP).
- Todo `a` recebe `target="_blank"` e `rel="noopener noreferrer"`.
- A mesma função `sanitizeHtml()` em `common/` é reutilizada por T21.

## 8. Casos de borda

| Situação                                                                    | Comportamento                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Agente move o ticket para um grupo do qual não participa e depois faz `GET` | `404 NOT_FOUND` (RN-01). A resposta do próprio `PATCH` ainda devolve o detalhe            |
| Responsável é removido do grupo depois de atribuído                         | Continua responsável e continua vendo o ticket (`assignee_id = eu`). Nada em cascata      |
| Solicitante é desativado                                                    | Tickets continuam visíveis aos agentes                                                    |
| Dois agentes fazem `PATCH` com a mesma `version`                            | O segundo recebe `409` com `currentVersion`; o front recarrega e mostra o aviso           |
| `PATCH` só com `version` e nenhum campo                                     | 200, nenhum evento, `version` não muda                                                    |
| `PATCH` com `status` igual ao atual                                         | Nenhum evento de status; outros campos processam normalmente                              |
| `bodyHtml` com `<script>`, `onclick`, `style`                               | Removidos; se sobrar texto, grava                                                         |
| `bodyHtml` só com `<img src="cid:...">`                                     | Imagem removida → `422 EMPTY_BODY`                                                        |
| `subject` com 201 caracteres                                                | `422 VALIDATION_ERROR`                                                                    |
| `q = "#1001"`                                                               | Busca por número                                                                          |
| `q = "a"`                                                                   | Filtro ignorado                                                                           |
| `pageSize = 500`                                                            | `422 VALIDATION_ERROR`                                                                    |
| Solicitante consulta `?view=all`                                            | `403 FORBIDDEN_ROLE`                                                                      |
| Agente com `groupIds = []`                                                  | `view=group` devolve vazio; ainda vê os tickets que solicitou ou que lhe foram atribuídos |
| Ticket criado por agente para um terceiro sem unidade                       | Permitido (RN-07); aparece em `noCompany`                                                 |
| Agente responde ao chamado que **ele mesmo** abriu                          | É o solicitante daquele ticket: RN-37 se aplica, RN-35 não                                |
| Supervisor atribui a agente de outro grupo                                  | Permitido (RN-26 dispensa supervisor+)                                                    |

## 9. Casos de teste

Fixture base: unidades U1, U2; grupos G1, G2; categoria C1 (grupo padrão G1), C2 (G2); usuários: `req1` (solicitante, U1), `req2` (solicitante, U2), `ext1` (terceiro, sem unidade), `ag1` (agente em G1), `ag2` (agente em G2), `sup` (supervisor), `adm` (admin).

| CT    | Dado                                                | Quando                                                                                                                 | Então                                                                                                                                                                     | Cobre               |
| ----- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CT-01 | `req1`                                              | `POST /tickets` com C1                                                                                                 | 201; `number = 1001`; `status = open`; `source = portal`; `group = G1`; `company = U1`; 1 mensagem `public`; evento `created`; evento de domínio `ticket.created` emitido | RN-04..RN-10        |
| CT-02 | `req1`                                              | `POST /tickets` com `requesterId = req2`                                                                               | 403 `FORBIDDEN_ROLE`                                                                                                                                                      | RN-05               |
| CT-03 | `ag1`                                               | `POST /tickets` com `requesterId = ext1`, sem `companyId`                                                              | 201; `source = agent`; `company = null`; `requester.isExternal = true`                                                                                                    | RN-05, RN-06, RN-07 |
| CT-04 | `req1` sem unidade (fixture extra)                  | `POST /tickets`                                                                                                        | 422 `COMPANY_REQUIRED`                                                                                                                                                    | RN-07               |
| CT-05 | `req1`                                              | `POST /tickets` com categoria inativa                                                                                  | 422 `INACTIVE_REFERENCE`                                                                                                                                                  | RN-08               |
| CT-06 | Ticket T de `req1` **fechado**                      | `req1` `POST /tickets` com `relatedTicketId = T`                                                                       | 201; evento `created.data.relatedTicketId = T`                                                                                                                            | RN-11               |
| CT-07 | Ticket T de `req2`                                  | `req1` `POST /tickets` com `relatedTicketId = T`                                                                       | 404 `NOT_FOUND`                                                                                                                                                           | RN-11, RN-02        |
| CT-08 | Tickets de `req1` e de `req2`                       | `req1` `GET /tickets`                                                                                                  | Só os de `req1`; view padrão `requested`; todos os status                                                                                                                 | RN-01, RN-13, RN-14 |
| CT-09 | Ticket de `req2`                                    | `req1` `GET /tickets/:id`                                                                                              | 404                                                                                                                                                                       | RN-02               |
| CT-10 | Tickets em G1 e G2                                  | `ag1` `GET /tickets`                                                                                                   | Só G1; status padrão `open,pending`                                                                                                                                       | RN-01, RN-13, RN-14 |
| CT-11 | Ticket em G2 atribuído a `ag1`                      | `ag1` `GET /tickets?view=mine`                                                                                         | Aparece                                                                                                                                                                   | RN-01, RN-13        |
| CT-12 | Ticket em G2 solicitado por `ag1`                   | `ag1` `GET /tickets?view=requested`                                                                                    | Aparece; `GET /tickets?view=group` não                                                                                                                                    | RN-01, RN-13        |
| CT-13 | —                                                   | `req1` `GET /tickets?view=all`                                                                                         | 403                                                                                                                                                                       | RN-13               |
| CT-14 | Tickets em G1 e G2                                  | `sup` `GET /tickets`                                                                                                   | Todos; view padrão `all`                                                                                                                                                  | RN-01, RN-13        |
| CT-15 | 3 sem responsável em G1, 2 em G2                    | `ag1` `GET /tickets?view=unassigned` → 3; `sup` → 5                                                                    | RN-13                                                                                                                                                                     |
| CT-16 | Tickets `#1001` e `#1002`                           | `GET /tickets?q=%231002` e `?q=1002`                                                                                   | Só `#1002`                                                                                                                                                                | RN-15               |
| CT-17 | Assuntos "Impressora" e "Internet"                  | `GET /tickets?q=impr`                                                                                                  | Só "Impressora" (case-insensitive)                                                                                                                                        | RN-15               |
| CT-18 | Tickets com e sem unidade                           | `ag1` `GET /tickets?noCompany=true&companyId=U1`                                                                       | Só os sem unidade                                                                                                                                                         | RN-16               |
| CT-19 | 30 tickets                                          | `GET /tickets?pageSize=10&page=2`                                                                                      | 10 itens, `total = 30`; `pageSize=500` → 422                                                                                                                              | RN-17               |
| CT-20 | Ticket com 1 `public` e 1 `internal`                | `req1` `GET /tickets/:id`                                                                                              | 1 mensagem; evento `message_added` da interna omitido                                                                                                                     | RN-19               |
| CT-21 | Mesmo ticket                                        | `ag1` `GET /tickets/:id`                                                                                               | 2 mensagens; ambos os eventos                                                                                                                                             | RN-19               |
| CT-22 | Dados do CT-15                                      | `ag1` `GET /tickets/counters`                                                                                          | `unassigned = 3`, `group` = total G1 aberto/pendente; `req1` → 403                                                                                                        | RN-18               |
| CT-23 | Ticket `version = 1`                                | `req1` `PATCH`                                                                                                         | 403                                                                                                                                                                       | RN-21               |
| CT-24 | Ticket `version = 1`                                | `ag1` `PATCH {version: 1, priority: high}`                                                                             | 200; `version = 2`; evento `priority_changed {from: medium, to: high}`                                                                                                    | RN-22, RN-29        |
| CT-25 | Ticket `version = 2`                                | `ag1` `PATCH {version: 1, ...}`                                                                                        | 409 com `currentVersion = 2`; nada gravado                                                                                                                                | RN-22               |
| CT-26 | Ticket `open`                                       | `PATCH {status: closed}` → 200 `closed_at` preenchido; depois `PATCH {status: open}` → 422 `TICKET_CLOSED`             | RN-23, RN-25                                                                                                                                                              |
| CT-27 | Ticket `resolved`                                   | `PATCH {status: pending}`                                                                                              | 422 `INVALID_TRANSITION`                                                                                                                                                  | RN-23               |
| CT-28 | Ticket sem unidade                                  | `PATCH {status: resolved}` → 422 `COMPANY_REQUIRED`; `PATCH {status: resolved, companyId: U1}` → 200 com `resolved_at` | RN-24, RN-25                                                                                                                                                              |
| CT-29 | Ticket `resolved`                                   | `PATCH {status: open}`                                                                                                 | `resolved_at = null`; evento `status_changed`                                                                                                                             | RN-25               |
| CT-30 | Ticket em G1                                        | `ag1` `PATCH {assigneeId: ag2}` → 422 `ASSIGNEE_NOT_IN_GROUP`; `sup` mesmo corpo → 200                                 | RN-26                                                                                                                                                                     |
| CT-31 | Ticket em G1                                        | `ag1` `PATCH {assigneeId: ag1}`                                                                                        | 200; evento `assigned {from: null, to: ag1}`; domínio `ticket.assigned`                                                                                                   | RN-26, RN-29        |
| CT-32 | Ticket em G1                                        | `ag1` `PATCH {groupId: G2}` → 200; `ag1` `GET /tickets/:id` → 404                                                      | RN-27, RN-01                                                                                                                                                              |
| CT-33 | Ticket de `ext1` sem unidade                        | `PATCH {companyId: U2, applyCompanyToRequester: true}`                                                                 | Ticket e `ext1` com U2; evento `company_changed`                                                                                                                          | RN-28               |
| CT-34 | Ticket `version = 1`                                | `PATCH {version: 1, priority: medium}` (mesmo valor)                                                                   | 200; nenhum evento; `version` continua 1                                                                                                                                  | RN-29               |
| CT-35 | Ticket de `req1`                                    | `req1` `POST /messages {kind: internal}`                                                                               | 403                                                                                                                                                                       | RN-32               |
| CT-36 | Ticket de `req2`                                    | `req1` `POST /messages {kind: public}`                                                                                 | 404                                                                                                                                                                       | RN-32, RN-02        |
| CT-37 | —                                                   | `POST /messages` com `<p>oi</p><script>x()</script><a href="javascript:alert(1)">l</a>`                                | Gravado `<p>oi</p><a target="_blank" rel="noopener noreferrer">l</a>` (href removido)                                                                                     | RN-33, §7           |
| CT-38 | —                                                   | `POST /messages` com `<img src="cid:abc">`                                                                             | 422 `EMPTY_BODY`                                                                                                                                                          | RN-33               |
| CT-39 | Ticket `closed`                                     | `POST /messages`                                                                                                       | 422 `TICKET_CLOSED`                                                                                                                                                       | RN-34               |
| CT-40 | Ticket `open` de `req1`, `first_response_at = null` | `ag1` `POST /messages {kind: public}`                                                                                  | `first_response_at` preenchido; status continua `open`                                                                                                                    | RN-35               |
| CT-41 | Mesmo ticket                                        | `ag1` `POST /messages {kind: internal}`                                                                                | `first_response_at` continua nulo; status igual                                                                                                                           | RN-38               |
| CT-42 | Ticket `open`, `version = 1`                        | `ag1` `POST /messages {kind: public, status: pending, version: 1}`                                                     | 201; status `pending`; `version = 2`; eventos `message_added` e `status_changed`                                                                                          | RN-36               |
| CT-43 | —                                                   | `ag1` `POST /messages {kind: public, status: pending}` sem `version`                                                   | 422 `VALIDATION_ERROR`                                                                                                                                                    | RN-36               |
| CT-44 | Ticket `pending` de `req1`                          | `req1` `POST /messages`                                                                                                | status `open`                                                                                                                                                             | RN-37               |
| CT-45 | Ticket `resolved` de `req1`                         | `req1` `POST /messages`                                                                                                | status `open`; `resolved_at = null`; evento com `reason = requester_reply`                                                                                                | RN-37               |
| CT-46 | Ticket aberto por `ag1` para si, `pending`          | `ag1` `POST /messages {kind: public}`                                                                                  | status `open` (é o solicitante); `first_response_at` não muda                                                                                                             | RN-37, §8           |
| CT-47 | —                                                   | `POST /messages`                                                                                                       | Evento de domínio `ticket.message_added` com `authorIsRequester` correto                                                                                                  | RN-39               |
| CT-48 | Request com `X-Forwarded-For: 10.0.0.5, 10.0.0.1`   | Qualquer escrita                                                                                                       | `ticket_events.ip = 10.0.0.5`                                                                                                                                             | RN-40               |
| CT-49 | Função `ticketScope` isolada                        | Para cada papel                                                                                                        | `where` esperado (teste unitário, sem banco)                                                                                                                              | RN-01               |
| CT-50 | Repositório de eventos                              | Tentar chamar update/delete                                                                                            | Não existe método (teste de tipo/compilação ou de ausência)                                                                                                               | §6                  |

## 10. Decisões tomadas na implementação

_(preencher após a sessão)_

## 11. Prompt sugerido para a sessão

Recomendo **duas sessões**: T08 (criação, listagem, detalhe, counters, `ticketScope`) e depois T09 + T10 (atualização e mensagens). O prompt da primeira:

```text
Leia docs/specs/T08-T10-tickets-core.md e o CLAUDE.md. Nesta sessão vamos implementar só a parte de T08: RN-01 a RN-20, rotas POST /tickets, GET /tickets, GET /tickets/counters, GET /tickets/:id, e os CTs 01 a 22, 49 e 50.

Antes de escrever código, apresente um plano com:
1. arquivos a criar ou alterar (módulo tickets: controller, service, repository com ticketScope, mappers de resposta; schemas zod em packages/shared; sanitizeHtml em common/; fixture de teste compartilhada com os usuários e grupos descritos em §9);
2. a ordem de implementação;
3. como cada CT vira um teste e2e (Supertest contra o banco de testes) ou unitário.

Aguarde minha aprovação. Depois implemente, nomeando cada teste com o identificador do CT. Ao final rode pnpm typecheck, pnpm lint e pnpm test e me mostre o resultado. Não implemente PATCH nem mensagens nesta sessão.
```

Segunda sessão: mesmo formato, com "RN-21 a RN-40, rotas PATCH /tickets/:id e POST /tickets/:id/messages, CTs 23 a 48".
