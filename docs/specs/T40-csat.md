# Spec T40 — Pesquisa de satisfação (CSAT)

> Status: pronta · Tarefas: T40 (#70) · Depende de: T14 (outbox e e-mail de resolvido), T35 (resolver em lote), T37 (relatórios) · Revisada em: 20/11/2026

## 1. Objetivo

Quando um chamado é **resolvido**, o e-mail que já vai ao solicitante passa a trazer um link para ele **avaliar o atendimento** de 1 a 5, com comentário opcional, numa página pública sem login. A avaliação aparece no painel do chamado e nos relatórios da T37, mas **só para supervisor e admin**.

## 2. Fora de escopo

- **Reabrir o chamado ou avisar alguém** por causa de nota baixa (decisão 5): a nota fica no painel e no relatório, com o filtro de notas baixas (RN-21).
- **Avaliar pelo portal**: a avaliação é só pelo link do e-mail. O solicitante não vê a própria nota no chamado (💡 decisão 9).
- **Pedir avaliação ao fechar**, inclusive no fechamento automático da T27 (decisão 2), e **lembretes**: o pedido vai uma vez por resolução, no e-mail de resolvido.
- **Mostrar a avaliação a agentes** (decisão 4): nem no chamado, nem no histórico, nem na fila.
- Perguntas extras, NPS, escala configurável ou textos editáveis pela tela.
- Avaliações dos chamados importados do Freshdesk (T29).

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                                                                   | Fonte                    | Confirmar? |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------- |
| O fragmento da URL (`#…`) não é enviado ao servidor pelo navegador: não aparece no log do Traefik, no log da API (`pino-http` grava `req.url`) nem no `Referer`        | 📘 RFC 3986 §3.5 / Fetch | —          |
| Filtros de link de e-mail (Outlook Safe Links, antivírus corporativos, pré-carregamento do Gmail) abrem os links do e-mail sozinhos, com `GET`, antes da pessoa clicar | 💡 prática conhecida     | —          |
| `@nestjs/throttler` (já é dependência) permite um limite por rota com `@Throttle`                                                                                      | 📘 docs                  | —          |

## 4. Regras de negócio

**Pedido de avaliação**

- **RN-01** — Toda vez que um chamado **passa para Resolvido** por um agente — `PATCH /tickets/:id`, resolver em lote (T35) ou resposta que resolve (`POST /tickets/:id/messages` com `status: resolved`) —, o e-mail que vai ao solicitante (template `resolved`, ou `reply` com "marcamos como resolvido") ganha o bloco de avaliação (RN-06). Não existe e-mail novo.
- **RN-02** — Fechar o chamado (manual ou pelo fechamento automático da T27) não pede avaliação (decisão 2).
- **RN-03** — O pedido vai a **todo solicitante que recebe o e-mail de resolvido**, inclusive terceiros (`is_external`) e quem só usa o canal de e-mail (decisão 8): o link não exige login. Quando o e-mail de resolvido não vai (solicitante inativo, agente que resolveu o próprio chamado, endereço da própria caixa — T14 RN-06), não há pedido.
- **RN-04** — Cada resolução gera um **link novo**, e o link anterior do mesmo chamado **deixa de valer** na hora (decisão 3), mesmo quando a nova resolução não manda e-mail (RN-03).
- **RN-05** — O link vale por **`CSAT_LINK_DAYS` dias** (padrão 30) a contar da resolução, ou até o chamado ser resolvido de novo (decisão 7). Reabrir ou fechar o chamado **não** invalida o link (💡 decisão 10: quem reabriu é justamente quem tem algo a dizer). `CSAT_LINK_DAYS=0` desliga a pesquisa: nenhum link novo, e os já enviados param de valer.

**E-mail**

- **RN-06** — O bloco de avaliação vem depois do texto de resolvido: "Como foi o atendimento? Escolha uma nota:" e cinco links, um por nota, com o rótulo (RN-09), seguidos de "O link vale por 30 dias." (com o valor de `CSAT_LINK_DAYS`). Na versão texto, uma linha por nota com o link. Cada link aponta para `<PORTAL_URL>/avaliar?nota=<n>#<token>`.
- **RN-07** — O token vai **no fragmento** (`#`), nunca no caminho nem na query, para não ficar nos logs (§3). 💡 decisão 11.

**Página pública**

- **RN-08** — `/avaliar` é uma página do front **sem login** (fora do `RequireAuth`, sem o menu). Ela lê o token do fragmento e consulta a API (RN-13). Mostra "Chamado #<número> — <assunto>" e a escala; com `?nota=<n>` válida, a nota já vem **marcada**, mas **só é gravada quando a pessoa clica em "Enviar avaliação"** (💡 decisão 12: filtros de link abrem o e-mail sozinhos, e um `GET` que grava registraria notas que ninguém deu). Um aviso diz "Falta só confirmar: clique em Enviar avaliação."
- **RN-09** — Escala de 1 a 5 com rótulos (decisão 1): 1 Muito insatisfeito · 2 Insatisfeito · 3 Neutro · 4 Satisfeito · 5 Muito satisfeito.
- **RN-10** — Comentário **sempre opcional** (decisão 6), texto puro de até **1.000 caracteres** (💡 decisão 13), sem HTML: espaços nas pontas são removidos, e comentário vazio vira nulo. Nunca é interpretado como HTML na tela.
- **RN-11** — Depois de enviar: "Obrigado! Sua avaliação foi registrada." Enquanto o link valer, abrir de novo mostra a nota e o comentário gravados e deixa **alterar** (decisão 7). A alteração **substitui** a anterior, e a data da avaliação passa a ser a da alteração.
- **RN-12** — Link inválido, expirado ou substituído → a página mostra "Este link de avaliação expirou ou foi substituído por um mais novo. Se precisar de ajuda, responda o e-mail do chamado." A página não diz qual dos três casos ocorreu.

**API pública**

- **RN-13** — Duas rotas `@Public()` (§5) recebem o token **no corpo** (que o log já censura) e só ele identifica o chamado. Token desconhecido, expirado ou substituído → `404 SURVEY_LINK_INVALID`. Limite de **30 requisições por minuto por IP** nessas rotas (💡 decisão 14), além do limite global.
- **RN-14** — O token tem 32 bytes aleatórios (base64url). O banco guarda só o **SHA-256** dele (💡 decisão 11), e a busca é pelo hash. Nem o token nem o hash aparecem no log.
- **RN-15** — Avaliar **não altera o chamado**: a versão e o `updated_at` não mudam (um agente editando o chamado não leva 409 por causa da avaliação), e não entra evento em `ticket_events` (o histórico é visível a agentes, decisão 4).

**Quem vê**

- **RN-16** — Só **supervisor e admin** veem avaliações (decisão 4). No detalhe do chamado (`GET /tickets/:id`), o campo `satisfaction` só vem para eles; para agentes e solicitantes ele **não existe** na resposta.
- **RN-17** — Painel do chamado (supervisor e admin): "Avaliação do solicitante" com a nota (`4 — Satisfeito`), o comentário e a data. Sem avaliação: "Aguardando avaliação (link enviado em dd/mm)" enquanto o link vale, ou "Sem avaliação".
- **RN-18** — Cada chamado tem **uma** avaliação, a última dada (decisão 3). Se o chamado for resolvido de novo e o solicitante não responder ao link novo, a avaliação anterior continua valendo até ser substituída.

**Relatórios (T37)**

- **RN-19** — Uma avaliação entra no período pela **data da avaliação** (`rated_at`, 💡 decisão 15). Nos totais, o bloco **Satisfação** mostra: % de satisfeitos (notas 4 e 5) sobre as avaliações do período, com os dois números ao lado; a **média** (uma casa decimal); e a **taxa de resposta**, que é, dos links enviados no período, quantos já foram respondidos. Sem avaliação no período, "—".
- **RN-20** — As tabelas por grupo, agente, unidade e categoria ganham a coluna **Satisfação** (% de satisfeitos e o número de avaliações), com as mesmas regras da RN-19 restritas aos chamados da linha (agente = responsável atual, como na T37 RN-12). O CSV das quebras ganha as colunas `avaliacoes`, `satisfeitos` e `media_satisfacao`.
- **RN-21** — Seção **Avaliações** no relatório: a lista das avaliações do período, da mais recente para a mais antiga, com nº do chamado (link), nota, comentário, responsável, grupo e data; interruptor **"Só notas 1 e 2"** (desligado por padrão); "Baixar CSV" no mesmo formato da T37 RN-16. A lista traz no máximo as **500** mais recentes, com o aviso "Mostrando as 500 mais recentes" quando houver mais. É uma exceção deliberada à T37 RN-17 (comentário e assunto aparecem), porque supervisor e admin já veem todos os chamados.
- **RN-22** — Os filtros de período e grupo do relatório valem para a RN-19, a RN-20 e a RN-21.

## 5. Contrato da API

Código novo em `ApiErrorCode`: `SURVEY_LINK_INVALID`.

### `POST /api/satisfaction/lookup`

Pública (`@Public()`), com o limite da RN-13. Corpo `{ "token": "<base64url>" }`.

`200`:

```json
{
  "ticketNumber": 1234,
  "ticketSubject": "Impressora da secretaria",
  "score": 4,
  "comment": "Resolveram rápido.",
  "ratedAt": "2026-11-21T13:05:00.000Z",
  "expiresAt": "2026-12-20T18:00:00.000Z"
}
```

`score`, `comment` e `ratedAt` são nulos antes da 1ª avaliação. Erros: `404 SURVEY_LINK_INVALID`, `422 VALIDATION_ERROR` (sem token), `429`.

### `PUT /api/satisfaction`

Pública, com o mesmo limite. Corpo `{ "token": "…", "score": 1..5, "comment": "…" | null }` (`comment` opcional, até 1.000 caracteres). Resposta `200` igual à do `lookup`, já com a nota gravada. Erros: `404 SURVEY_LINK_INVALID`, `422 VALIDATION_ERROR` (nota fora de 1–5, nota fracionada, comentário longo demais), `429`.

### `GET /api/tickets/:id` (alterada)

Para supervisor e admin, `satisfaction`:

```json
{
  "score": 4,
  "comment": "Resolveram rápido.",
  "ratedAt": "2026-11-21T13:05:00.000Z",
  "requestedAt": "2026-11-20T18:00:00.000Z",
  "linkActive": true
}
```

`null` quando o chamado nunca teve pedido. Para os outros papéis, o campo não vem (RN-16).

### `GET /api/reports/summary` (alterada)

`totals` e cada linha das quebras ganham:

```json
"satisfaction": { "responses": 42, "satisfied": 37, "average": 4.5, "requested": 120, "answered": 41 }
```

`average` nulo sem avaliação. `requested` e `answered` (taxa de resposta, RN-19) só nos totais; nas linhas vêm `0`.

### `GET /api/reports/satisfaction?from&to&groupId&low=true`

`@Roles('supervisor', 'admin')`. Mesmos filtros e validação do `summary` (T37 RN-02) e `low` opcional (`true` = só notas 1 e 2). `200`:

```json
{
  "items": [
    {
      "ticketId": "…",
      "ticketNumber": 1234,
      "ticketSubject": "Impressora da secretaria",
      "score": 2,
      "comment": "Demorou.",
      "ratedAt": "2026-11-21T13:05:00.000Z",
      "assignee": { "id": "…", "name": "Ana" },
      "group": { "id": "…", "name": "TI" }
    }
  ],
  "truncated": false
}
```

## 6. Dados

Migração nova `t40_ticket_satisfaction`:

```text
ticket_satisfaction
  ticket_id     uuid PK, FK tickets(id) ON DELETE CASCADE   -- uma linha por chamado (RN-18)
  token_hash    text NULL UNIQUE      -- SHA-256 hex do link atual; nulo = sem link válido (RN-04)
  requested_at  timestamptz NOT NULL  -- última resolução que mandou link (taxa de resposta, RN-19)
  expires_at    timestamptz NULL
  score         smallint NULL CHECK (score BETWEEN 1 AND 5)
  comment       text NULL
  rated_at      timestamptz NULL
  created_at, updated_at
  INDEX (rated_at), INDEX (requested_at)
```

- Resolução com e-mail ao solicitante: `upsert` da linha com o hash novo, `requested_at = agora` e `expires_at = agora + CSAT_LINK_DAYS`; `score`, `comment` e `rated_at` ficam como estão (RN-18). É gravada na **mesma transação** da resolução e da outbox (T14 RN-09).
- Resolução sem e-mail: se a linha existir, `token_hash` e `expires_at` ficam nulos (RN-04). Se não existir, nada é criado.
- O link completo, com o token, fica no `payload` da outbox (`csatUrl`), como o resto do e-mail congelado (T14 RN-10). Quem tem acesso ao banco já vê tudo, então isso não abre nada novo.

## 7. Configuração

- `CSAT_LINK_DAYS` (inteiro ≥ 0, padrão `30`; `0` desliga, RN-05). Sem segredo novo: o token é aleatório, não assinado.
- Nada muda no deploy (o valor padrão vale em produção).

## 8. Casos de borda

| Caso                                                                | Comportamento                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Filtro de link do e-mail abre os cinco links antes da pessoa        | Nada é gravado: só `lookup` (RN-08)                                                           |
| Solicitante clica no link de uma resolução anterior                 | `404 SURVEY_LINK_INVALID`, página da RN-12                                                    |
| E-mail encaminhado a outra pessoa                                   | Quem tem o link avalia (o token é a credencial). Aceito: é uma nota, não um acesso ao chamado |
| Solicitante desativado depois de receber o link                     | O link continua valendo (não depende de login)                                                |
| Chamado reaberto pela resposta do solicitante e ainda não resolvido | O link continua valendo (RN-05)                                                               |
| Resolução em lote de 50 chamados                                    | Um link por chamado, cada um na transação do seu chamado                                      |
| Duas abas enviando ao mesmo tempo                                   | Vale a última gravação                                                                        |
| `?nota=7`, `?nota=abc` ou sem `nota`                                | A página abre sem nota marcada                                                                |
| `/avaliar` sem fragmento                                            | Página da RN-12, sem chamar a API                                                             |
| Mudança de `CSAT_LINK_DAYS` depois de links enviados                | Vale o `expires_at` gravado. Só o `0` derruba os já enviados (RN-05)                          |
| Agente que é solicitante do próprio chamado e o resolve             | Sem e-mail, sem pedido (RN-03)                                                                |

## 9. Casos de teste

| CT    | Dado                                                                                            | Quando                                                                   | Então                                                                                                                                                      | Cobre               |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CT-01 | chamado aberto, solicitante ativo                                                               | agente resolve por `PATCH`                                               | Linha em `ticket_satisfaction` com hash e `expires_at` = +30 dias; outbox `resolved` com `csatUrl` = `<PORTAL_URL>/avaliar#<token>`, cujo SHA-256 é o hash | RN-01, RN-05, RN-14 |
| CT-02 | idem                                                                                            | resposta pública com `status: resolved`; e resolver em lote              | O `reply` (e cada `resolved` do lote) leva `csatUrl`                                                                                                       | RN-01               |
| CT-03 | chamado resolvido                                                                               | fecha manual e pelo fechamento automático                                | Nenhum e-mail, nenhum link novo                                                                                                                            | RN-02               |
| CT-04 | solicitante terceiro (`is_external`); solicitante inativo; agente que resolve o próprio chamado | resolve                                                                  | Terceiro recebe o link (sem `portalUrl`); inativo e agente-solicitante: sem linha nova                                                                     | RN-03               |
| CT-05 | link A de uma 1ª resolução, já respondido com nota 2                                            | reabre e resolve de novo                                                 | `lookup` com A → 404; link B vale; `score` 2 continua até B ser respondido                                                                                 | RN-04, RN-18        |
| CT-06 | link enviado; solicitante inativo na 2ª resolução                                               | resolve de novo                                                          | `token_hash` nulo: o link antigo dá 404                                                                                                                    | RN-04               |
| CT-07 | link com `expires_at` no passado; `CSAT_LINK_DAYS=0`                                            | `lookup` / resolve                                                       | 404; com `0`, nenhuma linha nova e o link existente dá 404                                                                                                 | RN-05               |
| CT-08 | payload com `csatUrl`                                                                           | `renderNotification('resolved')` e `('reply', resolved)`                 | HTML com 5 links `?nota=1..5#<token>` e os rótulos; texto com uma linha por nota; "vale por 30 dias"; sem `csatUrl` (linha antiga), sem bloco              | RN-06, RN-07, RN-09 |
| CT-09 | link válido                                                                                     | `lookup`                                                                 | 200 com número, assunto, `score: null`; nada gravado                                                                                                       | RN-08, RN-13        |
| CT-10 | link válido                                                                                     | `PUT` com nota 4 e comentário com espaços; depois nota 2 sem comentário  | 200; nota 4 e comentário aparado; depois nota 2, comentário nulo e `rated_at` novo                                                                         | RN-10, RN-11        |
| CT-11 | link válido                                                                                     | `PUT` com nota 0, 6, 3.5; comentário de 1.001 caracteres; sem token      | 422 VALIDATION_ERROR                                                                                                                                       | RN-09, RN-10, RN-13 |
| CT-12 | token aleatório desconhecido                                                                    | `lookup` e `PUT`                                                         | 404 SURVEY_LINK_INVALID                                                                                                                                    | RN-12, RN-13        |
| CT-13 | chamado com versão 3 e `updated_at` T                                                           | `PUT` da avaliação                                                       | Versão 3, `updated_at` T; nenhum evento novo em `ticket_events`                                                                                            | RN-15               |
| CT-14 | chamado avaliado                                                                                | `GET /tickets/:id` como supervisor, admin, agente e solicitante          | `satisfaction` presente para supervisor e admin; ausente para agente e solicitante                                                                         | RN-16               |
| CT-15 | log capturado                                                                                   | `lookup` e `PUT`                                                         | Nem o token nem o hash aparecem na saída do log                                                                                                            | RN-07, RN-14        |
| CT-16 | avaliações com `rated_at` dentro e fora do período; links enviados no período                   | `reportMetrics` (unitário) e `GET /reports/summary`                      | Totais: respostas, satisfeitos, média 1 casa, enviados e respondidos; linha por agente com a coluna; fora do período não conta                             | RN-19, RN-20, RN-22 |
| CT-17 | avaliações 1, 2, 5 no período, em dois grupos                                                   | `GET /reports/satisfaction` com `low=true` e `groupId`                   | Só as notas 1 e 2 do grupo, da mais recente para a mais antiga; `truncated` acima de 500                                                                   | RN-21, RN-22        |
| CT-18 | matriz de permissões                                                                            | `lookup`/`PUT` sem token de login; `GET /reports/satisfaction` por papel | Públicas: 404 (token de avaliação inválido) para todos, sem 401; relatório: 403 para agente e solicitante                                                  | RN-13, RN-21        |
| CT-19 | página `/avaliar?nota=4#tok` (web)                                                              | abre                                                                     | Mostra o chamado e a nota 4 marcada com o aviso de confirmar; nenhum `PUT` até clicar; ao enviar, mensagem de obrigado e botão Alterar                     | RN-08, RN-11        |
| CT-20 | `/avaliar` sem fragmento; `lookup` → 404 (web)                                                  | abre                                                                     | Mensagem da RN-12                                                                                                                                          | RN-12               |
| CT-21 | detalhe do chamado (web) como supervisor                                                        | com avaliação; sem avaliação com link ativo; sem pedido                  | "4 — Satisfeito" e o comentário; "Aguardando avaliação (link enviado em dd/mm)"; "Sem avaliação". Agente: nenhum bloco                                     | RN-17               |
| CT-22 | relatório (web)                                                                                 | carrega com avaliações                                                   | Bloco Satisfação nos totais, coluna nas quebras, lista com o interruptor "Só notas 1 e 2" e CSV                                                            | RN-19 a RN-21       |

## 10. Decisões tomadas na implementação

_(preenchido depois da implementação)_

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T40-csat.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Decisões

1. **Escala de 1 a 5 com rótulos**; satisfeito = notas 4 e 5 (20/11/2026).
2. **Pede ao resolver**, no e-mail de resolvido que já existe; fechar (inclusive o fechamento automático) não pede (20/11/2026).
3. **Uma avaliação por chamado, a última**: cada resolução manda um link novo e invalida o anterior (20/11/2026).
4. **Só supervisor e admin veem as avaliações**, no chamado e nos relatórios; agentes não veem nem a do próprio chamado (20/11/2026).
5. **Nota baixa não dispara nada**: fica no painel e no relatório, com filtro de notas baixas (20/11/2026).
6. **Comentário sempre opcional** (20/11/2026).
7. **Link vale 30 dias**, ou até a próxima resolução, e **a nota pode ser alterada** nesse prazo (20/11/2026).
8. **Todo solicitante que recebe o e-mail de resolvido recebe o link**, inclusive terceiros e quem só usa o e-mail (20/11/2026).
9. 💡 **Sem avaliação pelo portal**, e o solicitante não vê a própria nota no chamado: um caminho só, e nada a esconder dos agentes na tela do chamado.
10. 💡 **Reabrir não invalida o link**: só uma nova resolução o substitui, como pedido na decisão 7.
11. 💡 **Token aleatório no fragmento da URL, hash no banco**: nada de segredo novo, e o token não passa por nenhum log (Traefik, API, `Referer`).
12. 💡 **O clique no e-mail só pré-seleciona a nota**; gravar exige "Enviar avaliação", por causa dos filtros que abrem links sozinhos.
13. 💡 **Comentário em texto puro, até 1.000 caracteres**: não precisa de sanitização de HTML, e é exibido sempre como texto.
14. 💡 **Limite de 30 requisições/min por IP** nas rotas públicas, além do global. O token de 256 bits já impede adivinhação; o limite só corta abuso.
15. 💡 **Avaliação no relatório pela data em que foi dada**, e não pela data da resolução: o número de um período fechado só muda quando alguém altera a própria nota.
