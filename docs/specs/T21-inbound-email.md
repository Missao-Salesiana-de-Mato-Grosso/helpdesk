# Spec T21 — E-mail de entrada (IMAP → tickets)

> Status: implementada (24/10/2026) · Tarefas: T21 · Depende de: T03 (tabelas), T10 (mensagens), T13 (anexos), T14 (notificações) · Consumida por: T20 (runbook), virada do e-mail (`05-plano-mvp.md` §5.4) · Revisada em: 24/10/2026

## 1. Objetivo

O e-mail é o canal principal. Todo e-mail que chega a `suporte@missaosalesiana.org.br` precisa terminar num lugar só: vira um ticket novo, entra como mensagem num ticket existente, ou é descartado com o motivo registrado. Nunca pode sumir, duplicar ou entrar em loop. Um cron de 1 min lê a caixa por IMAP, guarda o `.eml` bruto, decide o destino pelo histórico de `Message-ID`s (e, na falta dele, pela tag `[#n]` no assunto) e reaproveita os services de tickets e de notificações (ADR-010).

## 2. Fora de escopo

- Envio de e-mail: T14. Esta spec só chama o `enqueue` dela.
- Participantes em cópia (Cc) que passam a acompanhar o ticket, encaminhamento interpretado ("agente encaminha o e-mail de um usuário"), outras caixas de e-mail: Fase 2.
- Tratar bounces das nossas notificações (marcar a notificação como `failed` pelo retorno): Fase 2. No MVP, o bounce é só descartado (RN-08).
- Reprocessar à mão um e-mail com `failed`: o runbook (T20) descreve como; não há tela.
- Gmail API, push via Pub/Sub, provedores de inbound parsing: descartados na ADR-010.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                           | Fonte                  | Confirmar?                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------- |
| Gmail IMAP em `imap.gmail.com:993` (TLS) com a senha de app da mesma conta usada no SMTP (T14)                                 | 📘 Google              | Etapa 1 de `docs/ambientes.md` (`suporte-teste@`) |
| No Gmail, um rótulo é uma pasta IMAP: copiar a mensagem para `helpdesk/processado` aplica o rótulo **sem tirá-la da INBOX**    | 📘 Google              | Teste com `suporte-teste@`                        |
| Os UIDs só crescem enquanto o `UIDVALIDITY` da pasta não muda. O Gmail raramente muda o `UIDVALIDITY`, mas o protocolo permite | 📘 RFC 3501            | —                                                 |
| O Gmail grava `Authentication-Results: mx.google.com; … dmarc=pass/fail …` em todo e-mail que recebe                           | 📘 Google              | Conferir num e-mail real (etapa 1)                |
| O Freshdesk lê a mesma caixa até a virada; os dois sistemas **não** rodam juntos na caixa real (§5.4 do plano)                 | 💡 `05-plano-mvp` §5.4 | —                                                 |
| O seed tem a categoria **"Geral"** (grupo "Suporte TI") e o usuário `system@helpdesk.local` (inativo)                          | 💡 `prisma/seed.ts`    | —                                                 |
| Dependências `imapflow` e `mailparser` (+ `@types/mailparser`), previstas na stack do `CLAUDE.md` e ainda não instaladas       | 💡                     | ⚠️ Aprovar antes da sessão (§12)                  |

## 4. Regras de negócio

### Leitura da caixa

- **RN-01** — Um cron a cada 1 min (`INBOUND_ENABLED`) lê a pasta `INBOX` e pega até `MAILBOX_BATCH_SIZE` mensagens com UID maior que o cursor `mailbox.last_uid` (em `app_settings`), em ordem crescente de UID. A flag de lido (`\Seen`) é ignorada: não é lida nem alterada.
- **RN-02** — **Primeira execução** (sem cursor): começa na primeira mensagem com data interna ≥ `MAILBOX_START_SINCE`. Sem essa variável, o cursor começa no UID mais alto atual, ou seja, nada do que já está na caixa vira ticket. O cursor inicial vai para o log.
- **RN-03** — O `UIDVALIDITY` fica em `mailbox.uid_validity`. Se mudar, o cursor é descartado e a leitura recomeça pela data interna da última mensagem processada (`max(received_at)` de `inbound_emails`). A idempotência (RN-05) impede duplicatas. O fato vai para o log com nível `warn`.
- **RN-04** — **O cursor avança mensagem a mensagem**, só depois que o destino foi gravado (`processed`, `discarded` ou `failed`). Falha de infraestrutura (banco ou storage fora do ar, conexão IMAP caiu) **interrompe o ciclo sem avançar**: a mensagem é tentada de novo no próximo minuto.
- **RN-05** — **Idempotência:** `inbound_emails.message_id` é único. Um `Message-ID` já registrado é ignorado sem nova linha, e o cursor avança. E-mail sem `Message-ID` recebe um sintético, `<sem-id-{sha256 do .eml}@inbound>`.
- **RN-06** — **Nunca apagar.** Depois de processar, a mensagem recebe o rótulo `helpdesk/processado`, `helpdesk/descartado` ou `helpdesk/erro` (os rótulos são criados se não existirem) e continua na INBOX. Ver a decisão ⚠️ da §12. Falha ao rotular vai para o log, mas não muda o destino nem trava o cursor.
- **RN-07** — O `.eml` bruto é gravado no storage (T13) em `inbound/<ano>/<mês>/<uuid>.eml`, e a chave vai para `inbound_emails.raw_storage_key`. Isso vale para os três destinos, exceto os duplicados da RN-05.

### Descarte (anti-loop e abuso)

- **RN-08** — O e-mail é descartado (`status = discarded`, com o `reason`), sem ticket, sem mensagem e sem resposta, quando:
  - `Auto-Submitted` existe e é diferente de `no` → `auto_submitted`;
  - `Precedence` é `bulk`, `junk`, `list` ou `auto_reply` → `bulk`;
  - tem `X-Autoreply`, `X-Autorespond` ou `X-Auto-Response-Suppress` → `auto_reply`;
  - o remetente é a própria caixa (`MAIL_FROM`), em qualquer combinação de maiúsculas → `own_address`;
  - é um bounce (`Content-Type: multipart/report`, ou remetente `mailer-daemon@`/`postmaster@`) → `bounce`;
  - o `Authentication-Results` do `mx.google.com` traz `dmarc=fail` → `dmarc_fail`. É a proteção contra alguém que forja o `From:` de um agente;
  - o remetente é um usuário com `active = false` → `inactive_sender`;
  - o remetente já tem `INBOUND_RATE_LIMIT_PER_HOUR` (20) e-mails em `inbound_emails` na última hora, em qualquer status → `rate_limited`, com log em `warn`.
- **RN-09** — A ordem das checagens é a da lista acima. A primeira que bater define o `reason`.

### Remetente

- **RN-10** — O remetente é o endereço do `From:` (`Reply-To` não conta para identidade), comparado com `users.email` (citext).
  - **Desconhecido** → cria o usuário sem login (`zitadel_sub = null`), com o nome de exibição do `From:` (ou a parte antes do `@`), `is_external = domínio ∉ INTERNAL_EMAIL_DOMAINS`, sem unidade nem departamento. No 1º login, ele é vinculado pelo e-mail (spec T04–T05).
  - A criação usa o `UsersService` (novo método `findOrCreateFromEmail`), na mesma transação do ticket.

### Para qual ticket

- **RN-11** — **Resolução do ticket**, nesta ordem:
  1. `In-Reply-To` e depois cada item de `References` (do último para o primeiro), contra `email_message_refs` (qualquer direção);
  2. a tag `[#n]` no assunto, se o ticket `n` existir **e** o remetente for o solicitante dele ou um agente (agente, supervisor ou admin). Ver a decisão ⚠️ da §12: quem só conhece o número não escreve em ticket alheio;
  3. senão, **ticket novo**.
- **RN-12** — **Ticket encontrado e não fechado** → mensagem **pública** com `via = email`, autor = remetente, mais os anexos (RN-17). As mesmas regras da T10 valem:
  - autor agente: não muda status (como no portal) e conta como primeira resposta;
  - autor solicitante, ou outra pessoa que não é agente: `pending` ou `resolved` → `open` (`reason: requester_reply`).
- **RN-13** — **Ticket encontrado e fechado** → ticket novo (RN-14) com `relatedTicketId` = o fechado, e o evento `created` com `data.relatedTicketId`, igual ao portal.
- **RN-14** — **Ticket novo** (`source = email`):
  - assunto do e-mail sem as tags `[#n]` e sem espaços extras; vazio → "(sem assunto)"; até 200 caracteres;
  - categoria "Geral" (o seu grupo padrão); unidade = a do remetente (pode ser nula; a triagem "sem unidade" resolve);
  - solicitante = remetente; prioridade `medium`.
  - Se a categoria "Geral" não existir ou estiver inativa, o e-mail vira `failed` (`reason: no_default_category`).
- **RN-15** — **Ator dos services:** os services de tickets ganham entradas para o e-mail (`createFromEmail`, `addEmailMessage`). Elas recebem o **autor** (o remetente) e operam com o escopo do ator do sistema: o remetente pode estar respondendo a um ticket que não está no escopo dele (um agente de outro grupo, por exemplo). O evento e a mensagem levam o id do remetente.
- **RN-16** — Toda mensagem ligada a ticket grava o `Message-ID` recebido em `email_message_refs` (`direction = inbound`), **antes** do `enqueue` da T14, na mesma transação. Assim, as notificações saem com `In-Reply-To` apontando para o e-mail da pessoa.

### Conteúdo

- **RN-17** — **Corpo:** a parte HTML, se houver; senão, o texto convertido para HTML (escape e `<br>`). Depois, o **separador de resposta** (RN-18) e a sanitização da allowlist (T08–T10 §7).
  - Corpo vazio depois de sanitizar → `<p>(e-mail sem texto)</p>`. Diferente do portal, um e-mail não pode ser recusado.
  - HTML sanitizado acima de 512 KB → usa a parte texto, cortada em 100 KB, com a nota "(e-mail muito longo; o original completo está guardado)".
- **RN-18** — **Texto novo × citado:** o trecho citado vai para `quoted_html` (oculto na UI, expansível), e o resto para `body_html`. Heurística própria, sem dependência (ver §12), que corta no primeiro destes marcadores:
  - HTML: `div.gmail_quote`, `blockquote[type=cite]`, `div#appendonsend`, `div#divRplyFwdMsg`, `div.moz-cite-prefix`;
  - texto: a linha "Em …, … escreveu:" ou "On … wrote:", `-----Original Message-----`/`-----Mensagem original-----`, ou o bloco "De: … Enviado(a): …".
  - Se o corte deixar o corpo vazio, tudo vai para `body_html`.
- **RN-19** — **Anexos** (partes com `Content-Disposition: attachment`, ou imagens inline com `cid:`) seguem as regras da T13 (tipo pela extensão, até 20 MB, até 5), pelo `AttachmentsService.storeFromBuffer`. Os que não passam **não derrubam o e-mail**: são pulados, e uma linha no fim do corpo lista os nomes ("Anexos não importados (tipo não aceito, acima de 20 MB ou além de 5): …"). O `.eml` bruto guarda tudo.
- **RN-20** — **Nunca logar** corpo, anexos nem o `.eml`. O log registra o UID, o id da linha em `inbound_emails`, o destino, o `reason` e o número do ticket. O endereço do remetente também não vai para o log: ele fica só em `inbound_emails`.

### Notificações (T14)

- **RN-21** — Ticket novo por e-mail → `enqueue(ticket_created)`: a confirmação vai ao remetente, no thread do e-mail dele, e o aviso ao grupo.
- **RN-22** — Mensagem num ticket existente → `enqueue(public_reply)`. **Ajuste na T14:** hoje o `public_reply` decide pelo "autor é o solicitante". Ele passa a decidir pelo **"autor é agente"**:
  - autor agente → `reply` ao solicitante;
  - qualquer outra pessoa (o solicitante ou um terceiro que respondeu o thread) → `requester_reply` ao responsável ou ao grupo.
  - No portal o comportamento não muda, porque lá só escrevem o solicitante e os agentes.
- **RN-23** — E-mail descartado ou com falha **não gera** notificação.

## 5. Contrato interno

Sem rota HTTP nova. Peças do módulo `inbound-email`:

```ts
// Fonte das mensagens: IMAP (produção) ou pasta de .eml (dev e testes).
interface MailboxSource {
  /** Mensagens depois do cursor, em ordem de UID; `null` na 1ª execução sem cursor. */
  fetchAfter(cursor: MailboxCursor | null, limit: number): Promise<MailboxBatch>;
  /** Aplica o rótulo do destino; nunca apaga. */
  label(uid: number, outcome: 'processed' | 'discarded' | 'failed'): Promise<void>;
}
interface MailboxCursor { uidValidity: string; lastUid: number }
interface MailboxBatch { uidValidity: string; messages: { uid: number; raw: Buffer; internalDate: Date }[] }

// InboundEmailService
processOne(message: { uid: number; raw: Buffer; internalDate: Date }): Promise<InboundOutcome>;
pollMailbox(): Promise<{ processed: number; discarded: number; failed: number; duplicates: number }>;
```

- Driver `folder`: cada `*.eml` em `MAILBOX_FOLDER_PATH`, em ordem de nome, com o UID = posição na ordem. Depois de processado, o arquivo vai para `processado/`, `descartado/` ou `erro/` (o equivalente aos rótulos), e o cursor é por nome de arquivo.
- `TicketsService.createFromEmail(author, data, files, messageRef)` e `addEmailMessage(author, ticketId, data, files, messageRef)`, com a RN-15.

## 6. Dados

Tabelas já criadas no T03:

- `inbound_emails`: `message_id` (único), `imap_uid`, `ticket_id`, `from_email`, `subject`, `raw_storage_key`, `status (processed|discarded|failed)`, `reason`, `received_at` (data do e-mail), `processed_at`; índice `(from_email, received_at)` para o limite da RN-08.
- `email_message_refs`, `ticket_messages.quoted_html` e `via = email`, `tickets.source = email`.
- `app_settings`: `mailbox.last_uid`, `mailbox.uid_validity`.

Nenhuma migração prevista. Se a sessão precisar de índice para o limite por remetente com `created_at`, cria-se uma migração nova.

## 7. Configuração

| Variável                            | Dev / testes             | Produção                                                                   |
| ----------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `MAILBOX_DRIVER`                    | `folder`                 | `imap`                                                                     |
| `MAILBOX_FOLDER_PATH`               | `./.inbox`               | —                                                                          |
| `MAILBOX_HOST` / `MAILBOX_PORT`     | —                        | `imap.gmail.com` / `993`                                                   |
| `MAILBOX_USER` / `MAILBOX_PASSWORD` | —                        | `suporte-teste@…` até a virada; depois `suporte@…` / senha de app (Secret) |
| `MAILBOX_START_SINCE`               | vazio                    | hora da desconexão do Freshdesk (§5.4)                                     |
| `INTERNAL_EMAIL_DOMAINS`            | `missaosalesiana.org.br` | idem (lista separada por vírgula)                                          |
| `INBOUND_RATE_LIMIT_PER_HOUR`       | `20`                     | `20`                                                                       |
| `INBOUND_ENABLED` (nova)            | `true` (testes: `false`) | `true`                                                                     |
| `MAILBOX_BATCH_SIZE` (nova)         | `50`                     | `50`                                                                       |
| `MAILBOX_LABEL_PREFIX` (nova)       | `helpdesk`               | `helpdesk`                                                                 |

Com `MAILBOX_DRIVER=imap`, a API não sobe sem `MAILBOX_USER` e `MAILBOX_PASSWORD`.

## 8. Casos de borda

| Situação                                                                       | Comportamento                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Solicitante responde a uma notificação (Gmail mantém `In-Reply-To`)            | RN-11.1: mensagem no ticket; `pending`/`resolved` → `open`                                 |
| Cliente de e-mail que não manda `In-Reply-To`, mas mantém `[#1001]` no assunto | RN-11.2, se for o solicitante ou um agente                                                 |
| Desconhecido escreve "[#1001]" no assunto de um e-mail novo                    | Ticket novo (a tag não basta, RN-11.2)                                                     |
| Colega do solicitante (em Cc na notificação) responde ao thread                | RN-11.1 bate pelo `In-Reply-To`: mensagem pública dele; aviso ao responsável/grupo (RN-22) |
| Agente responde pelo Gmail ao aviso de "requester_reply"                       | Mensagem pública de autoria do agente; `reply` ao solicitante pela T14                     |
| Agente manda um e-mail novo para `suporte@`                                    | Ticket novo, com o agente como solicitante                                                 |
| Resposta a ticket fechado                                                      | Ticket novo com `relatedTicketId` (RN-13)                                                  |
| Férias / resposta automática do solicitante à nossa confirmação                | `Auto-Submitted: auto-replied` → descartado. O loop morre aqui                             |
| Nosso próprio e-mail volta para a caixa (Bcc, encaminhamento)                  | `own_address`                                                                              |
| Mesmo e-mail lido duas vezes (API caiu antes de avançar o cursor)              | O 2º vira duplicado pelo `Message-ID`: nada novo                                           |
| 21º e-mail do mesmo remetente em 1 h                                           | `rate_limited`, log `warn`                                                                 |
| `.eml` corrompido, que o parser não lê                                         | `failed` com o erro em `reason`, rótulo `helpdesk/erro`, cursor avança                     |
| Banco fora do ar no meio do ciclo                                              | Ciclo para sem avançar o cursor; tenta de novo no próximo minuto (RN-04)                   |
| Anexo `.exe` junto de um PDF                                                   | PDF salvo; o `.exe` listado em "Anexos não importados"                                     |
| E-mail só com imagem colada (sem texto)                                        | Corpo "(e-mail sem texto)" e a imagem como anexo                                           |
| `UIDVALIDITY` mudou                                                            | RN-03: recomeça pela data; duplicados ignorados                                            |
| Remetente com nome "=?UTF-8?B?…?=" (codificado)                                | O `mailparser` decodifica; o usuário é criado com o nome legível                           |

## 9. Casos de teste

Fixtures `.eml` em `apps/api/test/fixtures/inbound/`, processadas pelo driver `folder` numa pasta temporária. Os testes chamam `pollMailbox()` direto (cron desligado). Usa a fixture de tickets da T08–T10 (req1, ext1, ag1 em G1 etc.), mais a categoria "Geral" em G1.

| CT    | Dado                                                                                                                          | Quando                                                            | Então                                                                                                                                                                                                                                           | Cobre                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| CT-01 | `novo-interno.eml` de `novo@missaosalesiana.org.br` (desconhecido)                                                            | `pollMailbox()`                                                   | Usuário criado sem login, `is_external = false`; ticket `source = email` em "Geral", sem unidade; mensagem `via = email`; `inbound_emails` `processed` com `ticket_id` e `raw_storage_key`; `ticket_created` e `ticket_created_group` na outbox | RN-07, RN-10, RN-14, RN-21 |
| CT-02 | `novo-externo.eml` de `fornecedor@empresa.com`                                                                                | `pollMailbox()`                                                   | Usuário `is_external = true`; confirmação sem link do portal                                                                                                                                                                                    | RN-10                      |
| CT-03 | Ticket de req1 com notificação enviada (`<tk-…>` em refs); `resposta.eml` de req1 com `In-Reply-To: <tk-…>`, ticket `pending` | `pollMailbox()`                                                   | Mensagem pública de req1 no ticket; status `open`; ref `inbound` gravada; `requester_reply` na outbox com `In-Reply-To` = o e-mail de req1 após o envio                                                                                         | RN-11, RN-12, RN-16, RN-22 |
| CT-04 | Igual, ticket `resolved`                                                                                                      | `pollMailbox()`                                                   | `resolved` → `open`                                                                                                                                                                                                                             | RN-12                      |
| CT-05 | Igual, ticket `closed`                                                                                                        | `pollMailbox()`                                                   | Ticket novo com `relatedTicketId` = o fechado; o fechado não muda                                                                                                                                                                               | RN-13                      |
| CT-06 | `so-tag.eml` de req1, sem cabeçalhos, assunto "Re: [#1001] Impressora"                                                        | `pollMailbox()`                                                   | Mensagem no #1001                                                                                                                                                                                                                               | RN-11.2                    |
| CT-07 | `so-tag.eml` de um desconhecido com "[#1001]"                                                                                 | `pollMailbox()`                                                   | Ticket novo (não toca o #1001); assunto sem a tag                                                                                                                                                                                               | RN-11.2, RN-14             |
| CT-08 | `resposta.eml` de ag1 com `In-Reply-To` conhecido                                                                             | `pollMailbox()`                                                   | Mensagem pública com autor ag1; status não muda; `first_response_at` preenchido; `reply` ao solicitante                                                                                                                                         | RN-12, RN-22               |
| CT-09 | Colega (não agente) responde com `In-Reply-To` conhecido                                                                      | `pollMailbox()`                                                   | Mensagem dele; `requester_reply` ao responsável/grupo, não ao solicitante                                                                                                                                                                       | RN-22                      |
| CT-10 | `ferias.eml` com `Auto-Submitted: auto-replied`                                                                               | `pollMailbox()`                                                   | `discarded`/`auto_submitted`; nada em tickets nem na outbox                                                                                                                                                                                     | RN-08, RN-23               |
| CT-11 | `Precedence: bulk`, `X-Autoreply`, From = `suporte@`, bounce, `dmarc=fail`, usuário inativo                                   | `pollMailbox()`                                                   | Um `discarded` para cada, com o `reason` certo                                                                                                                                                                                                  | RN-08, RN-09               |
| CT-12 | Mesmo `.eml` duas vezes                                                                                                       | `pollMailbox()` 2 vezes                                           | 1 ticket; 1 linha em `inbound_emails`                                                                                                                                                                                                           | RN-05                      |
| CT-13 | 21 e-mails do mesmo remetente                                                                                                 | `pollMailbox()`                                                   | 20 `processed` e 1 `rate_limited`                                                                                                                                                                                                               | RN-08                      |
| CT-14 | `quebrado.eml` (parser falha) seguido de `novo-interno.eml`                                                                   | `pollMailbox()`                                                   | 1º `failed` (pasta `erro/`), 2º `processed`; cursor depois dos dois                                                                                                                                                                             | RN-04, RN-06               |
| CT-15 | Storage que falha                                                                                                             | `pollMailbox()`                                                   | Nada gravado; cursor não avança; o próximo ciclo processa                                                                                                                                                                                       | RN-04                      |
| CT-16 | `com-anexos.eml`: PDF, PNG inline (`cid:`) e `.exe`                                                                           | `pollMailbox()`                                                   | 2 anexos salvos; corpo termina com "Anexos não importados: programa.exe"                                                                                                                                                                        | RN-19                      |
| CT-17 | `gmail-reply.eml` com `div.gmail_quote`; `outlook-reply.eml` com `divRplyFwdMsg`; `texto-reply.eml` com "Em …, … escreveu:"   | `pollMailbox()`                                                   | `body_html` só com o texto novo; o resto em `quoted_html`                                                                                                                                                                                       | RN-18                      |
| CT-18 | E-mail só com texto puro, com `<script>` e URLs                                                                               | `pollMailbox()`                                                   | Corpo escapado, com `<br>`; nada executável                                                                                                                                                                                                     | RN-17                      |
| CT-19 | E-mail sem texto, só imagem                                                                                                   | `pollMailbox()`                                                   | Corpo "(e-mail sem texto)"                                                                                                                                                                                                                      | RN-17                      |
| CT-20 | Primeira execução com 3 `.eml` e `MAILBOX_START_SINCE` depois do 1º                                                           | `pollMailbox()`                                                   | Só os 2 últimos viram ticket (driver `folder` usa a data do `.eml`)                                                                                                                                                                             | RN-02                      |
| CT-21 | Logger espionado                                                                                                              | Processar um e-mail com corpo e anexo                             | Nenhum log contém o corpo, o nome do anexo nem o e-mail do remetente                                                                                                                                                                            | RN-20                      |
| CT-22 | Separador (unitário)                                                                                                          | Casos de HTML e texto de Gmail, Outlook, Apple Mail e Thunderbird | Corte no lugar certo; sem marcador → tudo no corpo                                                                                                                                                                                              | RN-18                      |
| CT-23 | Anti-loop (unitário)                                                                                                          | Cabeçalhos das RN-08                                              | `reason` certo e na ordem da RN-09                                                                                                                                                                                                              | RN-08, RN-09               |

O driver `imap` tem um teste unitário com o `ImapFlow` falso (cursor, `UIDVALIDITY`, rótulos sem apagar). A validação real é com `suporte-teste@` (etapa 1 de `docs/ambientes.md`).

## 10. Decisões tomadas na implementação

- As 4 pendências da §12 foram aprovadas como recomendado:
  - dependências `imapflow` 2, `mailparser` 3 e `@types/mailparser`, com separador de resposta próprio;
  - só rotular e manter na INBOX (o `03-arquitetura` §3.3 foi corrigido);
  - tag `[#n]` sem cabeçalho só do solicitante e de agentes;
  - terceiro no thread entra como mensagem pública e avisa o responsável ou o grupo (ajuste `authorIsAgent` na T14).
- **Falha de infraestrutura × falha do e-mail** (RN-04):
  - o `.eml` bruto é gravado antes de tudo: storage fora do ar faz o ciclo parar sem gravar nada;
  - qualquer outro erro vira `failed` com o motivo, e o cursor segue;
  - se nem o `failed` consegue ser gravado (banco fora do ar), o erro sobe e o ciclo para.
  - Assim, um e-mail com defeito nunca trava a caixa, e uma queda nunca perde e-mail.
- **Idempotência e ticket na mesma transação:** a linha `processed` em `inbound_emails` e a ref `inbound` são gravadas pelo hook `EmailWrite` dentro da transação do ticket (antes do `enqueue`). Uma queda entre o commit e o avanço do cursor só gera um duplicado ignorado no ciclo seguinte.
- **Usuário do remetente** criado fora da transação do ticket (`UsersService.findOrCreateFromEmail`, que tolera corrida pelo `unique`). Se a transação falhar, sobra um usuário sem ticket, o que é inofensivo e é reaproveitado no próximo e-mail.
- **E-mail ilegível** (o parser lança erro) → `failed`/`parse_error`. **Sem `From:`** → `failed`/`no_sender`.
- **Driver `folder`:** o progresso é a própria pasta (o que ficou na raiz ainda não foi processado). Os anteriores a `MAILBOX_START_SINCE` vão para `ignorado/`, e a data vem do `Date:` do arquivo.
- **Driver `imap`:** o primeiro UID depois da virada é calculado pela data interna, porque o `SEARCH SINCE` só olha o dia. O cursor é gravado a cada e-mail. O logger do `imapflow` fica desligado (RN-20).
- Imagens inline sem nome viram `imagem-<n>.<ext>`. O `<head>` (título e estilos) é removido antes de sanitizar.
- Limite por remetente contado por `created_at` (hora de chegada no sistema), não pela data do e-mail, que o remetente controla.
- Testes: `test/inbound-email.e2e-spec.ts` (28), unitários em `src/inbound-email/*.spec.ts` (43, incluindo o driver `imap` com cliente falso) e fixtures em `test/fixtures/inbound/`.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T21-inbound-email.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Pendências antes da sessão

Resolvidas em 24/10/2026 (ver §10). Ficam registradas as opções:

1. **Dependências:** `imapflow`, `mailparser` e `@types/mailparser` (dev). O separador de resposta (RN-18) seria **heurística própria**, sem a lib `email-reply-parser`. Ela só trata texto puro, e o grosso dos e-mails que chegam é HTML do Gmail e do Outlook (recomendado).
2. **Depois de processar** (RN-06): **só rotular e manter na INBOX** (recomendado) **ou** rotular e tirar da INBOX (arquivar), como está no `03-arquitetura` §3.3. Manter na INBOX deixa o rollback da virada simples: se o Freshdesk for reconectado, ele ainda enxerga tudo. A INBOX não é usada por pessoas depois da virada, então a bagunça não pesa. Se escolher só rotular, o `03-arquitetura` é corrigido na sessão.
3. **Tag `[#n]` sem cabeçalho** (RN-11.2): aceitar só do solicitante e de agentes (recomendado) **ou** de qualquer remetente. Com "qualquer", alguém de fora que saiba o número consegue escrever num ticket que não é dele.
4. **Terceiro que responde ao thread** (RN-22): entra como mensagem pública dele e avisa o responsável ou o grupo (recomendado) **ou** é descartado. Isso exige o pequeno ajuste na T14 descrito na RN-22.
