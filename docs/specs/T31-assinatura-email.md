# Spec T31 — Assinatura de e-mail por agente

> Status: implementada (16/11/2026) · Tarefas: T31 (#45) · Depende de: T14 (notificações), T12 (compositor do agente), T26 (`HtmlEditor` com `insertHtml`) · Revisada em: 16/11/2026

## 1. Objetivo

Cada agente cadastra a própria assinatura de e-mail numa tela "Minha assinatura". Quando ele responde em público pelo portal, o e-mail `reply` que o solicitante recebe sai com a assinatura logo abaixo do corpo da resposta. A mensagem gravada no ticket e a conversa no portal não mudam.

## 2. Fora de escopo

- Enviar com o endereço do agente no `From`: o remetente continua `MAIL_FROM` (T14 RN-17).
- Assinatura na resposta que o agente manda pelo cliente de e-mail (T21): o corpo já pode trazer a assinatura do Gmail dele.
- Assinatura em nota interna (nunca gera e-mail, T14 RN-05) e nos e-mails automáticos (`ticket_created`, `ticket_created_group`, `requester_reply`, `resolved`, avisos da T22).
- Imagens e logo, tabelas, títulos e HTML livre. Logo institucional no rodapé, se desejado, é outra tarefa.
- Variáveis (`{{agente}}`, cargo) e cadastro de cargo ou telefone do usuário.
- Assinatura por grupo ou por caixa de entrada (T30).
- Admin ver, editar ou aprovar a assinatura de outro usuário.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                                | Fonte                              | Confirmar? |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------- |
| Clientes de e-mail tratam a linha `-- ` (dois hifens e um espaço) como início de assinatura na parte em texto puro                  | 📘 RFC 3676 §4.3                   | —          |
| O `payload` da outbox guarda tudo que o template precisa no momento do evento, e é lido de volta com zod                            | 💡 T14 RN-10 e §10                 | —          |
| O `reply` só é gerado quando o autor é agente e não é o solicitante do ticket                                                       | 💡 T14 RN-02, T21 RN-22            | —          |
| O editor do portal (`HtmlEditor`) produz só negrito, itálico, sublinhado, tachado, listas, citação, código e link                   | 💡 `apps/web/src/components`       | —          |
| Quem define a assinatura, onde ela entra e o que acontece na resposta pelo Gmail foram decididos pelo dono do produto em 16/11/2026 | 💡 discovery (msmt-workspace, #45) | —          |
| Nenhuma dependência nova                                                                                                            | 💡                                 | —          |

## 4. Regras de negócio

### Cadastro

- **RN-01** — A assinatura é do usuário: `users.signature_html`, nula quando ele não tem assinatura. Cada usuário lê e altera **só a própria**.
- **RN-02** — Só quem é agente (`agente`, `supervisor` ou `admin`, papel efetivo) acessa as rotas da assinatura. Os demais recebem 403.
- **RN-03** — O HTML recebido tem no máximo **2.000 caracteres** (antes da sanitização). Acima disso → 422 `VALIDATION_ERROR`.
- **RN-04** — A assinatura é sanitizada no backend **antes de gravar**, com uma allowlist própria, mais estreita que a do corpo das mensagens: `p`, `br`, `div`, `span`, `b`, `strong`, `i`, `em`, `u`, `s`, `a`, `ul`, `ol`, `li`, `blockquote`, `code`. Links seguem a regra do corpo (`http`, `https`, `mailto`; `target="_blank"` e `rel="noopener noreferrer"`). `img`, tabelas, títulos, `hr`, `pre`, estilos e scripts são descartados.
- **RN-05** — Assinatura sem texto visível depois de sanitizar (vazia, só espaços, só parágrafos vazios) é gravada como **nula**. É assim que se apaga.
- **RN-06** — A assinatura fica gravada mesmo que o usuário deixe de ser agente; ela só não é mais usada nem acessível (RN-02, RN-08).

### No e-mail

- **RN-07** — A assinatura entra **no envio**, pelo template `reply`. Ela nunca é gravada em `ticket_messages.body_html` nem devolvida nas rotas de tickets.
- **RN-08** — Leva assinatura a notificação que cumpre **tudo**:
  - template `reply` (T14 RN-02);
  - a mensagem foi escrita **no portal** (`via = portal`);
  - o autor tem assinatura (RN-05).
  - Em qualquer outro caso, o e-mail sai **exatamente como hoje**.
- **RN-09** — O `enqueue` copia a assinatura do autor para o `payload` (`signatureHtml`). Mudar ou apagar a assinatura depois não altera um e-mail já enfileirado, e um reenvio sai idêntico (T14 RN-10 e RN-11).
- **RN-10** — Linhas da outbox gravadas antes desta entrega não têm `signatureHtml`. Elas continuam válidas e saem sem assinatura.
- **RN-11** — **HTML:** a assinatura aparece dentro do bloco da mensagem, depois do corpo, separada por um espaço em branco. A frase "{agente} respondeu ao seu chamado…", o aviso de resolução, a linha "Responda este e-mail…", o link do portal e o rodapé "Suporte MSMT — Missão Salesiana de Mato Grosso" continuam como estão, na mesma ordem.
- **RN-12** — **Texto puro:** depois do corpo vem uma linha em branco, a linha `-- ` e a assinatura convertida para texto (mesma conversão do corpo).
- **RN-13** — "Responder e marcar como resolvido" (T14 RN-04): a assinatura vem logo depois do corpo, **antes** do aviso de resolução.
- **RN-14** — **Nunca logar** a assinatura. Vale a regra do corpo e do payload (T14 RN-20).

### Tela

- **RN-15** — "Minha assinatura" fica no menu do usuário (cabeçalho), visível só para agentes. A tela tem o editor das respostas, o botão **Salvar** e uma prévia de como a assinatura aparece abaixo de uma resposta. Salvar com o editor vazio apaga a assinatura. Textos em pt-BR.

## 5. Contrato da API

### `GET /api/me/signature`

- Papéis: `agente`, `supervisor`, `admin`. Solicitante e pendente → 403; anônimo → 401.
- 200: `{ "signatureHtml": "<p>João Silva</p>" }` ou `{ "signatureHtml": null }`.

### `PUT /api/me/signature`

- Papéis: os mesmos.
- Corpo (`updateSignatureSchema`, estrito): `{ "signatureHtml": string }`, de 0 a 2.000 caracteres.
- 200: `{ "signatureHtml": string | null }` com o valor **gravado** (já sanitizado; `null` pela RN-05).
- 422 `VALIDATION_ERROR`: campo ausente, de outro tipo, acima do limite, ou campo extra.

Nenhum código novo em `ApiErrorCode`. `GET`/`PATCH /api/me` e `MeResponse` não mudam.

### Contrato interno

```ts
// NotificationEvent: o public_reply passa a dizer por onde a mensagem entrou.
| { type: 'public_reply'; …; via: 'portal' | 'email' }

// UsersService (o módulo de notificações não lê `users` diretamente)
signatureOf(userId: string): Promise<string | null>;

// templates.ts
notificationPayload: { …, signatureHtml: z.string().nullable().optional() }
```

`TicketsService.addMessage` informa `via: 'portal'`; `addEmailMessage`, `via: 'email'`.

## 6. Dados

- Migração nova `t31_user_signature`: `ALTER TABLE users ADD COLUMN signature_html text NULL`. Sem índice e sem preenchimento dos existentes.
- `notifications.payload` (jsonb): campo novo opcional `signatureHtml`. Sem migração.

## 7. Configuração

Nenhuma variável nova. O limite de 2.000 caracteres é constante em `packages/shared` (`MAX_SIGNATURE_HTML_LENGTH`).

## 8. Casos de borda

| Situação                                                       | Comportamento                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Agente sem assinatura responde                                 | E-mail idêntico ao de hoje; `signatureHtml` nulo ou ausente no payload                      |
| Agente muda a assinatura com um `reply` ainda pendente         | O pendente sai com a antiga (RN-09)                                                         |
| Agente responde o aviso pelo Gmail                             | `reply` sem a assinatura do helpdesk (RN-08)                                                |
| Agente responde o chamado que ele mesmo abriu como solicitante | Vira `requester_reply` (T14 §8): sem assinatura                                             |
| Agente abre chamado em nome de um terceiro                     | `ticket_created`: sem assinatura                                                            |
| Nota interna, ou nota interna que resolve o ticket             | Nenhum e-mail, ou `resolved` sem texto: sem assinatura                                      |
| Assinatura só com `<img>` ou `<script>`                        | Sanitização esvazia → gravada como nula (RN-04, RN-05)                                      |
| Assinatura com link `javascript:`                              | O `href` é descartado; o texto do link fica                                                 |
| Solicitante chama as rotas direto                              | 403                                                                                         |
| Supervisor ou admin que também responde chamados               | Tem a própria assinatura, como qualquer agente                                              |
| Agente perde o papel e depois o recupera                       | A assinatura antiga volta a valer (RN-06)                                                   |
| Solicitante responde citando o nosso e-mail                    | A assinatura fica no trecho citado, que a T21 RN-18 já manda para `quoted_html`             |
| Linha antiga da outbox processada depois do deploy             | Enviada normalmente, sem assinatura (RN-10)                                                 |
| Anexos grandes demais (T14 RN-19)                              | A linha com os nomes dos anexos continua depois do bloco da mensagem; a assinatura não muda |

## 9. Casos de teste

Fixture de tickets da spec T08–T10 §9 (req1, ag1 em G1 etc.). Os testes de notificação chamam `processOutbox()` direto e conferem o e-mail entregue ao mailer de teste.

| CT    | Dado                                                    | Quando                                                                                                          | Então                                                                                                                   | Cobre               |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CT-01 | ag1 sem assinatura                                      | `GET /me/signature`                                                                                             | 200 com `signatureHtml: null`                                                                                           | RN-01               |
| CT-02 | ag1                                                     | `PUT` com `<p>João Silva</p><p>TI</p>`, depois `GET`                                                            | 200 nos dois, com o HTML gravado; `users.signature_html` de ag2 não muda                                                | RN-01               |
| CT-03 | —                                                       | `GET` e `PUT` como anônimo, solicitante, pendente, agente, supervisor e admin                                   | 401, 403, 403, 200, 200, 200 (linhas na matriz de permissões)                                                           | RN-02               |
| CT-04 | ag1                                                     | `PUT` com 2.001 caracteres; sem o campo; com campo extra                                                        | 422 `VALIDATION_ERROR` nos três; nada gravado                                                                           | RN-03               |
| CT-05 | ag1                                                     | `PUT` com `<script>`, `<img src="https://…">`, `<table>`, `<h1>`, `style`, link `javascript:` e um link `https` | Só o permitido sobrevive; o link `https` ganha `target` e `rel`                                                         | RN-04               |
| CT-06 | ag1 com assinatura                                      | `PUT` com `""`, com `<p> </p>` e com só `<img>`                                                                 | 200 com `signatureHtml: null` nos três; coluna nula                                                                     | RN-05               |
| CT-07 | ag1 com assinatura; ticket de req1                      | ag1 responde em público pelo portal; `processOutbox()`                                                          | Payload do `reply` com `signatureHtml`; no e-mail, a assinatura vem depois do corpo no HTML, e depois de `-- ` no texto | RN-08, RN-11, RN-12 |
| CT-08 | ag1 sem assinatura                                      | ag1 responde em público; `processOutbox()`                                                                      | HTML e texto iguais aos de hoje (sem `-- ` antes do rodapé)                                                             | RN-08               |
| CT-09 | ag1 com assinatura                                      | `resposta.eml` de ag1 com `In-Reply-To` conhecido; `pollMailbox()`                                              | `reply` ao solicitante **sem** `signatureHtml`                                                                          | RN-08               |
| CT-10 | ag1 com assinatura                                      | Nota interna; ticket aberto por ag1 em nome de ext1; `PATCH {status: resolved}`; ag1 responde o próprio chamado | Nenhuma linha da outbox traz `signatureHtml`                                                                            | RN-08               |
| CT-11 | ag1 com assinatura A; `reply` enfileirado               | ag1 troca para B; `processOutbox()`                                                                             | O e-mail sai com A                                                                                                      | RN-09               |
| CT-12 | Linha `reply` na outbox com payload sem `signatureHtml` | `processOutbox()`                                                                                               | `sent`, sem assinatura                                                                                                  | RN-10               |
| CT-13 | ag1 com assinatura                                      | ag1 responde com `status: resolved`                                                                             | Um `reply` só; a assinatura vem antes de "Marcamos este chamado como resolvido"                                         | RN-13               |
| CT-14 | ag1 com assinatura                                      | ag1 responde em público; `GET /tickets/:id`                                                                     | O `bodyHtml` da mensagem é só o que o agente escreveu                                                                   | RN-07               |
| CT-15 | Logger espionado                                        | Salvar a assinatura e enviar um `reply` assinado                                                                | Nenhum log contém o texto da assinatura                                                                                 | RN-14               |
| CT-16 | Templates (unitário)                                    | Render do `reply` com e sem `signatureHtml`, com e sem `resolved`                                               | Ordem dos blocos da RN-11 e RN-13; texto com `-- `; sem assinatura, saída idêntica à anterior                           | RN-11, RN-12, RN-13 |
| CT-17 | Sanitizador (unitário)                                  | Entradas do CT-05 e do CT-06                                                                                    | Saída esperada de cada uma                                                                                              | RN-04, RN-05        |
| CT-18 | Schema (unitário, shared)                               | 2.000 e 2.001 caracteres; campo extra; vazio                                                                    | Aceita 2.000 e vazio; recusa os outros                                                                                  | RN-03               |
| CT-19 | Tela (web), agente com assinatura salva                 | Abre "Minha assinatura"; edita; clica em Salvar                                                                 | O editor abre preenchido; o `PUT` leva o HTML; aparece a confirmação; a prévia mostra o texto                           | RN-15               |
| CT-20 | Tela (web)                                              | Solicitante e agente abrem o menu do usuário                                                                    | "Minha assinatura" só aparece para o agente; a rota `/assinatura` recusa o solicitante                                  | RN-15               |

## 10. Decisões tomadas na implementação

- As decisões da §12 foram mantidas como escritas.
- **Revisão pela T33 (18/11/2026):** a assinatura passou a aceitar até 2 imagens (`docs/specs/T33-imagem-assinatura.md`), e uma imagem sozinha conta como conteúdo, o que muda RN-04 e RN-05 desta spec.
- **Rotas no `MeController`**, com `@Roles` por método. O controller continua liberado para pendentes e para quem está no 1º acesso, mas quem não tem papel de agente para no `@Roles` (403), como a matriz de permissões confere.
- **Sanitizador próprio** (`sanitizeSignatureHtml`, em `common/sanitize-html.ts`), derivado da allowlist do corpo. Tag descartada perde a marcação e mantém o texto (`<h1>Título</h1>` vira `Título`), como no corpo das mensagens.
- **O `enqueue` só lê a assinatura quando há um `reply` a gravar** e a mensagem veio do portal. Sem assinatura, o campo `signatureHtml` nem entra no payload, então as linhas novas sem assinatura ficam iguais às antigas (RN-10).
- **CT-07 sem Mailpit:** o teste confere o HTML e o texto entregues ao mailer de teste, que é o que o SMTP recebe. Os cabeçalhos e o threading não mudaram e seguem cobertos pelos CTs 📬 da T14.
- **Prévia da tela:** mostra a assinatura **salva** (já sanitizada pelo backend), não o que está sendo digitado. Depois de salvar, a prévia atualiza.
- **`HtmlEditor` ganhou a prop `required`** (padrão `true`), para o rótulo da assinatura não aparecer como obrigatório.
- **Migração escrita à mão** (`20261116120000_t31_user_signature`), porque a máquina de desenvolvimento não tem o banco local. Pelo mesmo motivo, os e2e desta tarefa rodam só no CI.
- `POST /users/:id/access/approve` e as rotas vizinhas devolvem o registro inteiro do usuário, que agora inclui `signatureHtml`. Só admin e supervisor chamam essas rotas, e a assinatura não é dado sigiloso; ficou como está.
- Testes: `test/signature.e2e-spec.ts` (CT-01, 02, 04 a 06), matriz de permissões (CT-03), `test/notifications.e2e-spec.ts` (CT-07, 08, 10 a 15), `test/inbound-email.e2e-spec.ts` (CT-09), unitários `templates.spec.ts` (CT-16), `sanitize-html.spec.ts` (CT-17) e `signature.test.ts` no shared (CT-18), e `features/signature/signature.test.tsx` no web (CT-19, CT-20).

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T31-assinatura-email.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Pendências antes da sessão

Decididas pelo dono do produto em 16/11/2026: o próprio agente define a assinatura; ela entra no envio, não no editor; a resposta pelo Gmail não a recebe.

Seguem a recomendação do discovery, salvo aviso em contrário:

1. **Só texto formatado e links**, sem imagem (RN-04), com limite de 2.000 caracteres (RN-03).
2. **Só o template `reply`** (RN-08): o `ticket_created` de chamado aberto pelo agente em nome de alguém não leva assinatura.
3. **Sem assinatura, e-mail como hoje** (RN-08): não há assinatura padrão com o nome.
4. **A frase de abertura e o rodapé institucional continuam** (RN-11).
5. **Rotas próprias** (`/me/signature`) em vez de um campo novo em `GET`/`PATCH /me`: o `/me` é usado na tela de 1º acesso e liberado para pendentes; a assinatura é só de agentes.
