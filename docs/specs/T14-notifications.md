# Spec T14 — Notificações por e-mail (outbox)

> Status: implementada (24/10/2026) · Tarefas: T14 · Depende de: T08–T10 (tickets e mensagens), T13 (anexos) · Consumida por: T21 (e-mail de entrada) · Revisada em: 24/10/2026

## 1. Objetivo

O e-mail é o canal principal. Quando algo relevante acontece num ticket, quem precisa saber recebe um e-mail **no mesmo thread**: o solicitante (inclusive terceiros, que só existem por e-mail), o grupo e o responsável. Cada envio passa por uma **outbox** (`notifications`), gravada na mesma transação da mudança, e um cron de 1 min entrega com retry. Os cabeçalhos (`[#n]` no assunto, `Message-ID` próprio, `In-Reply-To`/`References`) permitem que a resposta por e-mail volte ao ticket certo (T21).

## 2. Fora de escopo

- **Leitura** da caixa e criação de ticket por e-mail: T21. Esta spec só define o `enqueue` que a T21 chama, e o uso de `email_message_refs` que a T21 alimenta com a direção `inbound`.
- Aviso ao novo responsável quando o ticket é atribuído, aviso de mudança de prioridade ou de grupo, lembretes e e-mail de SLA: não estão no MVP (`01-escopo.md` §5).
- Preferências de notificação por usuário (desligar, resumo diário): Fase 2.
- Envio de nota interna para qualquer pessoa: **nunca**.
- Pesquisa de satisfação (CSAT): Fase 2.
- Fila externa (Redis, SQS etc.): fora (ADR-009). A outbox é uma tabela.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                                                                                                                                                                                              | Fonte                    | Confirmar?                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| SMTP do Gmail: `smtp.gmail.com:587` com STARTTLS e **senha de app** de `suporte@` (exige verificação em 2 etapas)                                                                                                                                                                                 | 📘 Google                | Etapa 7 de `docs/ambientes.md`                                                                 |
| O Gmail preserva um `Message-ID` bem formado que o cliente envia                                                                                                                                                                                                                                  | ⚠️ `03-arquitetura` §3.3 | Teste com `suporte-teste@` (etapa 1). Se não preservar, o `[#n]` no assunto segura o threading |
| Limite de envio do Workspace: ~2.000 mensagens/dia por conta; o volume previsto é bem menor (≈ 500 tickets/mês)                                                                                                                                                                                   | 📘 Google                | —                                                                                              |
| A Magalu Cloud não tem serviço de envio de e-mail (equivalente ao SES), e os termos de uso proíbem usar a infraestrutura para enviar e-mail transacional "diretamente via SMTP". A leitura é que isso veta um servidor SMTP próprio no cluster, e não o envio autenticado pelo Gmail na porta 587 | ⚠️ termos de uso Magalu  | Confirmar com o suporte da Magalu antes do deploy (T17) e testar a saída na 587 do cluster     |
| Mailpit captura a saída em dev (`localhost:1025`, API em `localhost:8025/api/v1`)                                                                                                                                                                                                                 | 💡 `docker-compose.yml`  | —                                                                                              |
| `groups.email` é opcional; o seed põe `suporte@missaosalesiana.org.br` no grupo "Suporte TI" (a própria caixa do help desk)                                                                                                                                                                       | 💡 `prisma/seed.ts`      | Ver RN-08                                                                                      |
| Dependências: `nodemailer` (+ `@types/nodemailer`) e `@nestjs/schedule`, previstas na stack do `CLAUDE.md` e ainda não instaladas                                                                                                                                                                 | 💡                       | ⚠️ Aprovar antes da sessão (§12)                                                               |

## 4. Regras de negócio

### Quando e para quem (`01-escopo.md` §5, item 5)

- **RN-01** — **Ticket criado** (portal, agente em nome de outro, ou e-mail na T21):
  - `ticket_created` → o **solicitante**: confirmação com o número, o assunto e a primeira mensagem;
  - `ticket_created_group` → o **grupo** do ticket (RN-08): aviso de ticket novo na fila, com solicitante, unidade, categoria e primeira mensagem.
- **RN-02** — **Resposta pública de quem não é o solicitante** (agente) → `reply` ao **solicitante**, com o corpo da resposta.
- **RN-03** — **Resposta pública do solicitante** (portal ou e-mail) → `requester_reply` ao **responsável**; sem responsável, ao **grupo** (RN-08).
- **RN-04** — **Ticket resolvido** (status passa a `resolved`, pelo `PATCH` ou por "responder e marcar como resolvido") → `resolved` ao **solicitante**, com o aviso de que responder reabre o chamado.
  - Se a resolução vier junto com uma resposta pública na mesma requisição, sai **um e-mail só**: o `reply`, com o aviso de resolução no fim (template `reply` com `resolved = true`).
- **RN-05** — **Nota interna nunca gera e-mail**, para ninguém. Nenhum outro evento gera e-mail no MVP: mudança de prioridade, grupo, categoria, unidade ou responsável, ida para `pending` ou `closed`, e reabertura pelo solicitante (a resposta dele já gera o `requester_reply`).

### Destinatários

- **RN-06** — Nunca se envia para:
  - **quem causou o evento** (o agente que respondeu não recebe cópia da própria resposta). Única exceção: o `ticket_created` vai ao solicitante mesmo quando foi ele quem abriu pelo portal, porque é a confirmação por e-mail de que o chamado existe e o início do thread;
  - usuário com `active = false` (inclui o ator do sistema `system@helpdesk.local`);
  - o próprio endereço do help desk (`MAIL_FROM`), em qualquer combinação de maiúsculas;
  - o mesmo endereço duas vezes na mesma notificação lógica (dedupe por e-mail, `citext`).
- **RN-07** — Terceiros (`is_external = true`) recebem normalmente como solicitantes. O e-mail deles **não leva o link do portal** (não fazem login).
- **RN-08** — **"Grupo" como destinatário:** se `groups.email` estiver preenchido e não for o endereço do help desk (RN-06), envia para ele; senão, para **cada membro ativo** do grupo com role `agente`, `supervisor` ou `admin` (uma linha na outbox por pessoa). Grupo sem e-mail e sem membros → nenhuma linha (não é erro).

### Outbox e entrega

- **RN-09** — As linhas de `notifications` são gravadas pelo `NotificationService.enqueue(tx, …)` **dentro da transação** que grava o ticket ou a mensagem (ADR-009). Se a transação desfaz, nenhum e-mail sai; se ela confirma, o e-mail sai mesmo que o SMTP esteja fora do ar no momento.
- **RN-10** — O `payload` guarda **tudo que o template precisa no momento do evento** (número, assunto, nomes, corpo HTML da mensagem, anexos, link). Editar o ticket depois não muda um e-mail ainda não enviado.
- **RN-11** — O `Message-ID` é gerado **no enqueue** e gravado em `email_message_id`: `<tk-{ticketId}-{uuid}@{MAIL_MESSAGE_ID_DOMAIN}>`. Assim, um reenvio depois de uma falha usa o mesmo `Message-ID`.
- **RN-12** — Cron a cada 1 min (`@nestjs/schedule`), ligado por `NOTIFICATIONS_ENABLED`:
  - pega até `NOTIFICATIONS_BATCH_SIZE` linhas com `status = pending` e `send_after <= now()`, em ordem de `created_at`;
  - usa `FOR UPDATE SKIP LOCKED`, para que duas réplicas da API nunca enviem a mesma linha;
  - envia uma a uma pelo Nodemailer.
- **RN-13** — **Sucesso:** `status = sent`, `sent_at = now()`, e uma linha em `email_message_refs` (`message_id` = o `Message-ID` enviado, `direction = outbound`, `ticket_id`).
- **RN-14** — **Falha:** `attempts + 1` e `last_error` com o código e a mensagem do SMTP (até 500 caracteres, **sem corpo do e-mail**).
  - Falha temporária (rede, timeout, resposta SMTP 4xx): `send_after = now() + backoff`, com backoff de 1, 2, 4, 8 e 16 min.
  - Na 6ª falha (`NOTIFICATIONS_MAX_ATTEMPTS`), ou em resposta SMTP 5xx (destinatário recusado, por exemplo): `status = failed`, sem novas tentativas.
- **RN-15** — Uma falha não interrompe o lote: as outras linhas seguem. Uma exceção inesperada no cron é logada e não derruba a API.

### Conteúdo e cabeçalhos

- **RN-16** — **Assunto:** `[#{número}] {assunto do ticket}`, igual em todos os e-mails do ticket (sem `Re:`), para o Gmail agrupar e para o fallback da T21.
- **RN-17** — **Cabeçalhos:**
  - `From` e `Reply-To`: `MAIL_FROM`;
  - `Message-ID`: o da RN-11;
  - **thread por destinatário:** os `Message-ID`s recebidos no ticket (`email_message_refs`, `inbound`) e os e-mails que **este destinatário** já recebeu do ticket. Avisos enviados a outras pessoas (ao grupo, por exemplo) ficam de fora, porque ele nunca os viu;
  - `In-Reply-To`: o mais recente desse thread;
  - `References`: até os 10 mais recentes, do mais antigo para o mais novo. Thread vazio → sem esses dois cabeçalhos;
  - `Auto-Submitted: auto-generated` nos e-mails automáticos: `ticket_created`, `resolved` e os avisos internos (`ticket_created_group`, `requester_reply`). O `reply` traz o texto de uma pessoa e vai sem esse cabeçalho, para não ser filtrado como auto-resposta;
  - `X-Helpdesk-Ticket: {número}`, para diagnóstico.
- **RN-18** — **Corpo:** HTML simples com estilos inline, mais uma parte em texto puro gerada do mesmo conteúdo. Todo texto vem do `payload` com escape; o corpo da mensagem já foi sanitizado na gravação (spec T08–T10 §7) e entra como está.
  - Todos levam a linha _"Responda este e-mail para continuar o atendimento."_ e, para quem faz login, o link do portal `{PORTAL_URL}/tickets/{id}`.
  - Textos em pt-BR, datas no fuso de Cuiabá.
- **RN-19** — **Anexos da mensagem** no e-mail: ver a decisão ⚠️ da §12. Proposta: arquivos anexados ao e-mail quando o total couber em `NOTIFICATIONS_MAX_ATTACHMENT_BYTES` (padrão 20 MB); acima disso, a lista dos nomes com o aviso de que estão no portal.
- **RN-20** — **Nunca logar** corpo, payload ou anexos. O log do cron registra só o id da notificação, o template, o status e o código do erro.

## 5. Contrato interno

Não há rota HTTP nova. A interface é o service, usado pelos services de tickets e pela T21:

```ts
// apps/api/src/notifications/notification.service.ts
enqueue(tx: Prisma.TransactionClient, event: NotificationEvent): Promise<void>;

type NotificationEvent =
  | { type: 'ticket_created'; ticketId: string; messageId: string; actorId: string }
  | { type: 'public_reply'; ticketId: string; messageId: string; actorId: string; resolved: boolean }
  | { type: 'resolved'; ticketId: string; actorId: string };

// O cron chama; os testes também, sem esperar o relógio.
processOutbox(now?: Date): Promise<{ sent: number; failed: number; retried: number }>;
```

- `enqueue` decide destinatários e templates (RN-01 a RN-08), lê o que precisa **pela `tx`** e grava as linhas. Não envia nada.
- `public_reply` cobre RN-02 e RN-03: o service vê se o autor é o solicitante.
- A T21 chama `enqueue(tx, { type: 'ticket_created' | 'public_reply', … })` depois de gravar o `Message-ID` recebido em `email_message_refs` (`inbound`), para que o `In-Reply-To` aponte para o e-mail do usuário.

## 6. Dados

Tabelas já criadas no T03 (sem migração prevista):

- `notifications`: `ticket_id`, `to_email`, `template`, `payload jsonb`, `status (pending|sent|failed)`, `attempts`, `last_error`, `send_after`, `sent_at`, `email_message_id`, `created_at`; índice `(status, send_after)`.
- `email_message_refs`: `message_id` (PK), `ticket_id`, `direction (inbound|outbound)`, `created_at`; índice `(ticket_id)`.
- `groups.email` (opcional).

Se a sessão precisar de índice para o `In-Reply-To` (`email_message_refs(ticket_id, created_at)`), cria-se uma migração nova.

## 7. Configuração

| Variável                                    | Dev (Mailpit)                                   | Produção                                     |
| ------------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| `SMTP_HOST` / `SMTP_PORT`                   | `localhost` / `1025`                            | `smtp.gmail.com` / `587`                     |
| `SMTP_SECURE`                               | `false`                                         | `false` (STARTTLS na 587)                    |
| `SMTP_USER` / `SMTP_PASSWORD`               | vazio                                           | `suporte@…` / senha de app (Secret)          |
| `MAIL_FROM`                                 | `Suporte MSMT <suporte@missaosalesiana.org.br>` | idem                                         |
| `PORTAL_URL`                                | `http://localhost:5173`                         | `https://suporte.msmt.org.br`                |
| `MAIL_MESSAGE_ID_DOMAIN` (nova)             | `suporte.msmt.org.br`                           | idem                                         |
| `NOTIFICATIONS_ENABLED` (nova)              | `true`                                          | `true` (nos testes: `false`)                 |
| `NOTIFICATIONS_BATCH_SIZE` (nova)           | `20`                                            | `20`                                         |
| `NOTIFICATIONS_MAX_ATTEMPTS` (nova)         | `6`                                             | `6`                                          |
| `NOTIFICATIONS_MAX_ATTACHMENT_BYTES` (nova) | `20971520`                                      | idem (o Gmail aceita até 25 MB por mensagem) |

As novas entram no `.env.example` e no `config/env.ts`. A senha de app só existe no Secret do Kubernetes.

## 8. Casos de borda

| Situação                                                         | Comportamento                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agente abre chamado em nome de um terceiro                       | `ticket_created` ao terceiro (sem link do portal) e `ticket_created_group` ao grupo, menos o próprio agente                     |
| Agente responde ao chamado que ele mesmo abriu como solicitante  | É resposta do solicitante (RN-03): vai ao responsável ou ao grupo, menos ele                                                    |
| Solicitante é o responsável (agente atendendo o próprio chamado) | RN-06 tira o ator; se não sobrar ninguém, nenhuma linha                                                                         |
| Grupo "Suporte TI" com `email = suporte@…` (a própria caixa)     | RN-06/RN-08: cai para os membros do grupo; nunca manda para a própria caixa (evita loop e ruído)                                |
| "Responder e marcar como Resolvido"                              | Um único `reply` com `resolved = true` (RN-04)                                                                                  |
| `PATCH` para `resolved` sem mensagem                             | `resolved` ao solicitante                                                                                                       |
| Ticket move de grupo depois do enqueue                           | O e-mail já enfileirado não muda (RN-10)                                                                                        |
| SMTP fora do ar por 1 h                                          | Linhas acumulam com backoff; quando volta, saem em ordem. Depois da 6ª falha (~31 min), `failed`                                |
| Destinatário inexistente (550)                                   | `failed` na hora, com o código em `last_error`                                                                                  |
| Duas réplicas da API rodando o cron                              | `SKIP LOCKED`: cada linha é enviada por uma réplica só                                                                          |
| E-mail enviado, mas a API cai antes de marcar `sent`             | No próximo ciclo reenvia com o **mesmo** `Message-ID` (RN-11). Duplicata possível e aceita; o cliente de e-mail costuma agrupar |
| Anexos somam mais que o limite                                   | Lista dos nomes e "veja no portal" (RN-19)                                                                                      |
| Usuário desativado entre o enqueue e o envio                     | Envia mesmo assim (a decisão é tomada no enqueue). Fica registrado aqui como aceito                                             |

## 9. Casos de teste

Fixture de tickets da spec T08–T10 §9 (req1, req2, ext1, ag1 em G1, ag2 em G2, sup, adm). Os testes chamam `processOutbox()` direto (cron desligado) e conferem a outbox no banco e, nos CTs marcados com 📬, o e-mail recebido no Mailpit pela API dele.

| CT    | Dado                                                        | Quando                                                                 | Então                                                                                                                                                                                                            | Cobre                      |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| CT-01 | G1 sem e-mail, com ag1                                      | req1 cria ticket em C1                                                 | 2 linhas `pending`: `ticket_created` → req1, `ticket_created_group` → ag1                                                                                                                                        | RN-01, RN-08               |
| CT-02 | G1 com `email = fila-ti@…`                                  | req1 cria ticket                                                       | `ticket_created_group` → `fila-ti@…` (não para ag1)                                                                                                                                                              | RN-08                      |
| CT-03 | G1 com `email = suporte@…` (o `MAIL_FROM`)                  | req1 cria ticket                                                       | Aviso vai para ag1, nunca para `suporte@`                                                                                                                                                                        | RN-06, RN-08               |
| CT-04 | —                                                           | ag1 cria ticket para ext1                                              | `ticket_created` → ext1 **sem** link do portal; nenhum e-mail para ag1                                                                                                                                           | RN-06, RN-07               |
| CT-05 | Ticket de req1                                              | ag1 responde em público                                                | `reply` → req1 com o corpo da resposta                                                                                                                                                                           | RN-02                      |
| CT-06 | Ticket de req1 sem responsável, G1 com ag1 e sup            | req1 responde                                                          | `requester_reply` → ag1 e sup                                                                                                                                                                                    | RN-03, RN-08               |
| CT-07 | Ticket de req1 atribuído a ag2                              | req1 responde                                                          | `requester_reply` → só ag2                                                                                                                                                                                       | RN-03                      |
| CT-08 | Ticket de req1                                              | ag1 grava nota interna                                                 | Nenhuma linha                                                                                                                                                                                                    | RN-05                      |
| CT-09 | Ticket de req1, com unidade                                 | `PATCH {status: resolved}`                                             | `resolved` → req1                                                                                                                                                                                                | RN-04                      |
| CT-10 | Ticket de req1                                              | ag1 responde com `status: resolved`                                    | Uma linha só: `reply` com `resolved = true`                                                                                                                                                                      | RN-04                      |
| CT-11 | —                                                           | `PATCH` de prioridade, grupo, responsável; status `pending` e `closed` | Nenhuma linha                                                                                                                                                                                                    | RN-05                      |
| CT-12 | Transação que falha depois do enqueue (ticket fechado)      | Resposta em ticket `closed`                                            | 422 e nenhuma linha na outbox                                                                                                                                                                                    | RN-09                      |
| CT-13 | 📬 Linha `reply` pendente; ticket com 1 ref inbound `<a@x>` | `processOutbox()`                                                      | No Mailpit: assunto `[#1001] …`, `Message-ID` = `email_message_id`, `In-Reply-To: <a@x>`, `References: <a@x>`, `From`/`Reply-To` = `MAIL_FROM`; a linha vira `sent`; `email_message_refs` ganha a ref `outbound` | RN-11, RN-13, RN-16, RN-17 |
| CT-14 | 📬 Ticket sem refs                                          | `processOutbox()` do `ticket_created`                                  | Sem `In-Reply-To`/`References`; com `Auto-Submitted: auto-generated`                                                                                                                                             | RN-17                      |
| CT-15 | SMTP que falha com timeout                                  | `processOutbox()` 2 vezes                                              | `attempts = 2`, `last_error` preenchido, `send_after` = agora + 2 min, status `pending`                                                                                                                          | RN-14                      |
| CT-16 | SMTP que recusa com 550                                     | `processOutbox()`                                                      | `failed` na 1ª tentativa                                                                                                                                                                                         | RN-14                      |
| CT-17 | Linha com `attempts = 5`                                    | Mais uma falha temporária                                              | `failed`                                                                                                                                                                                                         | RN-14                      |
| CT-18 | 3 linhas, a 2ª com falha                                    | `processOutbox()`                                                      | 1ª e 3ª `sent`; a 2ª com retry                                                                                                                                                                                   | RN-15                      |
| CT-19 | Linha com `send_after` no futuro                            | `processOutbox()`                                                      | Não é enviada                                                                                                                                                                                                    | RN-12                      |
| CT-20 | Duas chamadas de `processOutbox()` em paralelo              | 5 linhas pendentes                                                     | Cada linha enviada uma vez só                                                                                                                                                                                    | RN-12                      |
| CT-21 | 📬 Resposta com 1 anexo de 1 KB                             | `processOutbox()`                                                      | E-mail no Mailpit com o anexo e o nome original                                                                                                                                                                  | RN-19                      |
| CT-22 | Anexos que somam mais que o limite                          | `processOutbox()`                                                      | Sem anexos; o corpo lista os nomes e manda ver no portal                                                                                                                                                         | RN-19                      |
| CT-23 | Ticket aberto, depois o assunto/grupo muda                  | `processOutbox()` de uma linha antiga                                  | Usa o `payload` gravado no enqueue                                                                                                                                                                               | RN-10                      |
| CT-24 | Logger espionado                                            | Envio com sucesso e com falha                                          | Nenhum log contém o corpo da mensagem nem o payload                                                                                                                                                              | RN-20                      |
| CT-25 | Templates (unitário)                                        | Render de cada template com nomes contendo `<script>`                  | Texto escapado; corpo da mensagem como veio; parte texto sem tags; link do portal só para quem faz login                                                                                                         | RN-07, RN-18               |

## 10. Decisões tomadas na implementação

- As 4 pendências da §12 foram aprovadas como recomendado: enqueue na transação, anexos no e-mail até 20 MB, aviso a cada membro quando o grupo não tem e-mail, e as dependências `nodemailer` 10, `@types/nodemailer` e `@nestjs/schedule`. O SMTP continua sendo o Gmail do Workspace: a Magalu não tem serviço de envio (§3).
- **Reserva do lote por lease:** o `processOutbox` faz `UPDATE … SET send_after = now + 5 min WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING id` e envia fora de transação. Isso evita manter a transação aberta durante o SMTP. Se a API cair no meio, a linha volta sozinha depois de 5 min, com o mesmo `Message-ID`.
- **Thread por destinatário** (RN-17, ajustada na sessão): no primeiro desenho, o `In-Reply-To` usava qualquer ref do ticket. Com isso, a confirmação do solicitante citava o aviso enviado ao grupo, que ele nunca recebeu. Agora o thread de cada pessoa junta os e-mails recebidos no ticket e os que ela própria já recebeu. O `email_message_refs` continua recebendo toda saída (`outbound`), porque a T21 casa as respostas por ele.
- **Destinatários lidos pelos services exportados** (`UsersService.contactsByIds`, `GroupsService.notificationTarget`, `namesByIds` de unidades e categorias). Os dados do ticket vêm do chamador (`NotifiedTicket`), porque o ticket recém-criado só existe dentro da transação.
- O `payload` é validado com zod ao ser lido da outbox. Template desconhecido ou payload inválido conta como falha comum: vai para retry e, depois, para `failed`.
- Anexo sumido do storage: o e-mail sai só com os nomes, e o log registra o id da notificação.
- Nota interna que resolve o ticket gera o `resolved`, sem o texto da nota.
- Os CTs viraram `test/notifications.e2e-spec.ts` (30 testes; os 📬 conferem o e-mail no Mailpit) e os unitários `templates.spec.ts` e `mailer.spec.ts`.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T14-notifications.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Pendências antes da sessão

Resolvidas em 24/10/2026 (ver §10). Ficam registradas as opções:

1. **Enqueue dentro da transação** (RN-09, recomendado, é o que a ADR-009 diz) **ou** num listener dos eventos de domínio depois do commit (já existem desde a T08). O listener é mais desacoplado, mas um e-mail se perde se a API cair entre o commit e o enqueue.
2. **Anexos no e-mail** (RN-19): anexar até 20 MB no total (recomendado: terceiros não acessam o portal, e para eles o e-mail é o único canal) **ou** só listar os nomes com o link do portal.
3. **Grupo sem e-mail** (RN-08): avisar cada membro (recomendado) **ou** não avisar ninguém até o grupo ter um e-mail cadastrado.
4. **Dependências:** `nodemailer`, `@types/nodemailer` (dev) e `@nestjs/schedule`.
