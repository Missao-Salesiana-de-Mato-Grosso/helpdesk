# Spec T32 — Imagens no corpo da mensagem

> Status: implementada (18/11/2026) · Tarefas: T32 (#47) · Depende de: T13 (anexos), T14 (notificações), T21 (e-mail de entrada), T08–T10 (sanitização) · Revisada em: 18/11/2026

## 1. Objetivo

Agentes e solicitantes inserem imagens no meio do texto pelo editor do portal. A imagem aparece no lugar certo na conversa e vai embutida nos e-mails que carregam o corpo da mensagem. Imagens coladas no corpo de e-mails recebidos passam a aparecer no texto, em vez de virarem anexo solto.

## 2. Fora de escopo

- Imagem na assinatura do agente (T33, reaproveita o mecanismo desta spec).
- Imagem em respostas prontas (T26): o editor de respostas prontas continua sem imagem.
- Editar a imagem (cortar, girar) e redimensionar por arraste. A largura exibida é limitada pela largura do texto.
- Inserir imagem por URL digitada.
- Ampliar a imagem em tela cheia ao clicar.
- Reprocessar mensagens antigas: imagens de e-mails já recebidos continuam como anexos.
- Otimizar ou recomprimir a imagem no servidor.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                                            | Fonte                                                             | Confirmar? |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------- |
| Imagem embutida por `Content-ID` (`<img src="cid:…">` + parte `multipart/related`) é exibida por Gmail e Outlook sem bloqueio de imagem externa | 📘 RFC 2392, RFC 2387                                             | —          |
| O `nodemailer` monta a parte embutida quando o anexo tem a propriedade `cid`                                                                    | 📘 nodemailer, "Embedded images"                                  | —          |
| O `mailparser` devolve, para cada anexo, `cid` e `related`; com `keepCidLinks: true` o HTML mantém `src="cid:…"`                                | 📘 mailparser; já usado na T21                                    | —          |
| O Gmail não exibe imagens `data:` (base64) em e-mail                                                                                            | 📘 comportamento conhecido do Gmail                               | —          |
| O token do portal fica em memória e não acompanha um `<img src>`; o download de anexo é por `fetch` com Bearer                                  | 💡 T13, CLAUDE.md                                                 | —          |
| A CSP já libera `img-src blob:`                                                                                                                 | 💡 `common/security.ts`                                           | —          |
| Imagem embutida no e-mail, agentes e solicitantes inserem, e-mail de entrada incluído                                                           | 💡 dono do produto, 16/11/2026 (discovery no msmt-workspace, #47) | —          |
| Dependência nova: `@tiptap/extension-image`, na mesma versão do Tiptap em uso                                                                   | 💡 aprovada pelo dono do produto em 16/11/2026                    | —          |

## 4. Regras de negócio

### Envio pelo portal

- **RN-01** — Uma imagem no texto é um anexo da mensagem marcado como **inline** (`attachments.inline = true`). Usa o mesmo storage e a mesma regra de acesso dos anexos (T13).
- **RN-02** — Vale em toda mensagem escrita no portal: abertura de chamado, resposta pública e nota interna, para agentes e solicitantes.
- **RN-03** — Tipos aceitos: `png`, `jpg`/`jpeg`, `gif`, `webp` (pela extensão, como na T13). Outro tipo → 415 `UNSUPPORTED_FILE_TYPE`.
- **RN-04** — Cada imagem inline tem no máximo **5 MB**. Acima → 413 `FILE_TOO_LARGE`.
- **RN-05** — No máximo **10 imagens inline por mensagem**, contadas à parte dos 5 anexos comuns (T13). Acima → 422 `VALIDATION_ERROR` (o schema de `inlineImages` recusa antes de olhar os arquivos).
- **RN-06** — O HTML gravado referencia a imagem como `<img data-attachment-id="<id do anexo>" alt="…">`, sem `src`. O `body_html` nunca guarda `data:`, `blob:` nem URL da API.
- **RN-07** — O atributo `data-attachment-id` só existe no HTML gravado quando foi o **servidor** que o escreveu, a partir de uma imagem enviada na mesma requisição. Um `data-attachment-id` que venha do cliente é descartado, assim como `<img>` com `src` em `data:` ou `blob:`. `<img>` com `src` `http`/`https` continua aceito como hoje.
- **RN-08** — Imagem enviada que não é referenciada no texto (o usuário apagou antes de enviar) não é gravada. `<img>` que referencia uma chave sem arquivo é removida do texto.
- **RN-09** — Uma mensagem só com imagem, sem texto, é válida (tem conteúdo).
- **RN-10** — Gravação é tudo ou nada, como na T13: se a mensagem falhar, as imagens já gravadas no storage são apagadas.

### Conversa no portal

- **RN-11** — A conversa mostra cada imagem inline no ponto do texto em que foi inserida, baixando o arquivo com o token do usuário. A largura máxima é a do texto.
- **RN-12** — Anexos inline **não** aparecem na lista de anexos da mensagem.
- **RN-13** — Enquanto a imagem carrega, e se o download falhar, o lugar dela mostra o texto alternativo (`alt`, ou "imagem"). A falha de uma imagem não impede a leitura da mensagem.
- **RN-14** — Quem não pode ver a mensagem não baixa a imagem: vale a regra de acesso ao anexo da T13 (escopo do ticket; nota interna só para agentes).

### E-mail de saída

- **RN-15** — Em todo e-mail que carrega o corpo da mensagem (`reply`, `requester_reply`, `ticket_created`, `ticket_created_group`), cada imagem inline vai embutida: o HTML usa `src="cid:<id>@<domínio dos Message-IDs>"` e o arquivo vai como parte relacionada, não como anexo comum.
- **RN-16** — Na versão em texto do e-mail, a imagem vira `[imagem: <nome do arquivo>]`.
- **RN-17** — O teto `NOTIFICATIONS_MAX_ATTACHMENT_BYTES` (T14 RN-19) passa a valer em duas etapas: se as imagens inline cabem no teto, vão embutidas; os anexos comuns vão junto se a soma (inline + comuns) também couber, senão só os nomes, como hoje.
- **RN-18** — Se as imagens inline sozinhas passam do teto, ou alguma não está no storage, nenhuma é embutida: no HTML cada uma vira o texto `[imagem: <nome>]`, e o e-mail ganha a linha "Imagens grandes demais para o e-mail, disponíveis no portal." (sem "disponíveis no portal" para quem não faz login, T14 RN-07).
- **RN-19** — O payload da outbox continua congelado (T14 RN-10): guarda, por anexo, o id e a marca inline. Linhas gravadas antes desta spec não têm esses campos e são tratadas como anexos comuns.

### E-mail de entrada

- **RN-20** — Num e-mail recebido, o anexo aceito (regras da T21 RN-19) cujo `Content-ID` é referenciado por um `<img src="cid:…">` do corpo gravado (corpo ou texto citado) é gravado como **inline**, e a tag passa a `<img data-attachment-id="…">`.
- **RN-21** — `<img src="cid:…">` sem anexo aceito correspondente é removida do texto, como hoje. Anexo com `Content-ID` que o texto gravado não referencia continua anexo comum.
- **RN-22** — Os limites de RN-04 e RN-05 não se aplicam ao e-mail de entrada: valem só os da T21 (um e-mail não pode ser recusado).

### Editor

- **RN-23** — O editor oferece o botão "Inserir imagem" e aceita colar e arrastar imagens, nos formulários de abertura de chamado, de resposta do solicitante e no compositor do agente. Nos demais usos do editor (respostas prontas, assinatura) nada muda.
- **RN-24** — O editor recusa na hora, com mensagem, a imagem de tipo não aceito, maior que 5 MB ou que passe de 10 imagens. A validação do servidor (RN-03 a RN-05) é a que vale.
- **RN-25** — A imagem aparece no editor assim que inserida (prévia local) e só sobe ao servidor no envio da mensagem.

## 5. Contrato da API

Nenhuma rota nova. Mudam as duas rotas que criam mensagem.

### `POST /api/tickets` e `POST /api/tickets/:id/messages`

Em `multipart/form-data`:

- campo `data`: o JSON de hoje, com o campo opcional `inlineImages: string[]` (chaves, até 10, cada uma com 1 a 64 caracteres `[A-Za-z0-9_-]`, sem repetição);
- campo `files`: anexos comuns, como hoje;
- campo `inline`: os arquivos das imagens, **na mesma ordem** de `inlineImages`.

No `bodyHtml` enviado, cada imagem é `<img data-inline-key="<chave>" alt="…">`. O servidor troca por `data-attachment-id` (RN-06).

Erros novos (códigos já existentes):

| Situação                                                          | Resposta                    |
| ----------------------------------------------------------------- | --------------------------- |
| Quantidade de arquivos em `inline` diferente da de `inlineImages` | 422 `VALIDATION_ERROR`      |
| Mais de 10 imagens                                                | 422 `TOO_MANY_FILES`        |
| Imagem maior que 5 MB                                             | 413 `FILE_TOO_LARGE`        |
| Arquivo em `inline` que não é imagem aceita                       | 415 `UNSUPPORTED_FILE_TYPE` |

### Resposta

`TicketAttachment` ganha `inline: boolean`. O `bodyHtml` e o `quotedHtml` devolvidos trazem `<img data-attachment-id>`.

### `GET /api/attachments/:id`

Sem mudança: serve também os anexos inline, com a mesma regra de acesso.

### Contrato interno

- Payload da outbox: cada item de `attachments` ganha `id?: string` e `inline?: boolean`.
- `OutgoingMail.attachments[]` ganha `cid?: string`.

## 6. Dados

- `attachments.inline BOOLEAN NOT NULL DEFAULT false` (migração; linhas existentes ficam `false`).

## 7. Configuração

Nenhuma variável nova. Constantes em `packages/shared`: `INLINE_IMAGE_MAX_BYTES` (5 MB), `INLINE_IMAGE_MAX_FILES` (10), tipos de imagem aceitos.

## 8. Casos de borda

| Caso                                                        | Comportamento                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Mesma chave usada em duas `<img>` do texto                  | As duas apontam para o mesmo anexo.                                                                                      |
| Requisição JSON (sem multipart) com `<img data-inline-key>` | A tag é removida (não há arquivo).                                                                                       |
| `inlineImages` com chave que o texto não usa                | O arquivo não é gravado (RN-08).                                                                                         |
| Texto colado de outra mensagem com `data-attachment-id`     | Atributo descartado; a imagem some (RN-07).                                                                              |
| Imagem `http`/`https` colada de uma página                  | Mantida como hoje, por URL.                                                                                              |
| Usuário cola imagem `data:` de outro programa               | Arquivo de imagem colado vira imagem inline; `<img src="data:…">` colado como HTML é descartado no editor e no servidor. |
| Storage sem o arquivo na hora do e-mail                     | RN-18.                                                                                                                   |
| Reenvio de notificação depois de falha                      | Usa o payload congelado; a imagem é lida de novo do storage.                                                             |
| E-mail recebido com a mesma imagem referenciada duas vezes  | Um anexo inline, duas tags.                                                                                              |
| E-mail recebido cuja imagem foi recusada (tipo ou tamanho)  | Tag removida; o nome entra na lista de recusados da T21.                                                                 |
| Nota interna com imagem                                     | Gravada e exibida a agentes; não gera e-mail ao solicitante (T14 RN-05).                                                 |

## 9. Casos de teste

**API (e2e)**

- **CT-01** (RN-01, RN-06) — Resposta pública em multipart com uma imagem: 201; anexo `inline: true`; `bodyHtml` com `data-attachment-id` igual ao id do anexo e sem `src`.
- **CT-02** (RN-02) — Abertura de chamado por solicitante com imagem, e nota interna de agente com imagem: gravadas como em CT-01.
- **CT-03** (RN-03) — Arquivo `.pdf` no campo `inline` → 415 `UNSUPPORTED_FILE_TYPE`; nada gravado.
- **CT-04** (RN-04) — Imagem de 5 MB + 1 byte → 413 `FILE_TOO_LARGE`.
- **CT-05** (RN-05) — 11 imagens → 422; 10 imagens mais 5 anexos comuns → 201.
- **CT-06** (RN-07) — `bodyHtml` com `data-attachment-id` de anexo de outra mensagem e com `<img src="data:…">`: as duas tags são removidas.
- **CT-07** (RN-08) — Imagem enviada sem referência no texto: não vira anexo. `<img data-inline-key>` sem arquivo: removida.
- **CT-08** (RN-09) — Mensagem só com imagem: 201.
- **CT-09** (RN-14) — Solicitante de outro ticket → 404 no download da imagem; solicitante do ticket não baixa imagem de nota interna.
- **CT-10** (contrato) — Quantidade de arquivos diferente de `inlineImages` → 422 `VALIDATION_ERROR`.
- **CT-11** (RN-15, RN-16) — E-mail `reply` de mensagem com imagem: HTML com `src="cid:…"`, anexo com o mesmo `cid`, texto com `[imagem: nome]`.
- **CT-12** (RN-15) — `requester_reply` e `ticket_created_group` também embutem a imagem.
- **CT-13** (RN-17) — Inline cabe no teto e a soma com os anexos comuns não: imagem embutida, anexos só por nome.
- **CT-14** (RN-18) — Inline acima do teto: nenhum `cid`; HTML com `[imagem: nome]` e a linha de aviso.
- **CT-15** (RN-20) — E-mail recebido com imagem `cid` no corpo: anexo `inline: true` e `bodyHtml` com `data-attachment-id`.
- **CT-16** (RN-21) — E-mail recebido com `cid` sem anexo correspondente: tag removida; anexo com `Content-ID` não referenciado: anexo comum.

**API (unitário)**

- **CT-17** (RN-06, RN-07) — Sanitizador: troca `data-inline-key` conhecido por `data-attachment-id`; descarta chave desconhecida, `data-attachment-id` do cliente, `data:` e `blob:`; mantém `<img src="https://…">`.
- **CT-18** (RN-15, RN-16, RN-18, RN-19) — Render: `cid` no HTML, `[imagem: nome]` no texto, substituição por texto quando não embutida, payload antigo sem `id`/`inline`.

**Shared**

- **CT-19** (contrato) — `inlineImages`: aceita até 10 chaves válidas; recusa 11, chave repetida e chave com caracteres inválidos.

**Web**

- **CT-20** (RN-11, RN-12, RN-13) — Conversa: a imagem inline é baixada com o token e exibida; não aparece na lista de anexos; com falha no download fica o texto alternativo.
- **CT-21** (RN-23, RN-25) — Compositor: inserir imagem e enviar manda `inline` + `inlineImages` e `bodyHtml` com `data-inline-key`; imagem removida do texto não é enviada.
- **CT-22** (RN-24) — Editor recusa tipo não aceito, imagem maior que 5 MB e a 11ª imagem, com mensagem.
- **CT-23** (RN-23) — Editor de respostas prontas e de assinatura não têm o botão "Inserir imagem".

## 10. Decisões tomadas na implementação

- **Ids gerados na aplicação.** O servidor gera o id (`randomUUID`) de cada imagem antes de sanitizar, porque o `body_html` já precisa referenciá-lo; `attachments.id` recebe esse valor no `createMany`.
- **Um só sanitizador.** `sanitizeHtml(html, resolveImage?)`: o resolver liga uma `<img>` a um anexo (pela `data-inline-key` no portal, pelo `cid:` no e-mail). Sem resolver, `data-attachment-id` vindo da entrada é sempre descartado; o resto da allowlist não mudou. Respostas prontas (T26) e o importador do Freshdesk chamam sem resolver.
- **RN-05 com `VALIDATION_ERROR`.** O limite de 10 está no schema de `inlineImages` (`packages/shared`), que roda antes do serviço; por isso 11 imagens dão 422 `VALIDATION_ERROR`, não `TOO_MANY_FILES`. O multer aceita até 11 arquivos no campo `inline` para a mensagem certa chegar ao cliente.
- **Teto em duas etapas (RN-17).** Primeiro as imagens que o corpo referencia; os anexos comuns entram se couberem no que sobra. Se as imagens não foram embutidas, os anexos comuns disputam o teto inteiro, como antes da T32. Imagem inline que só aparece no texto citado não vai no e-mail.
- **`ticket_created` também embute.** O e-mail de confirmação ao solicitante já levava o corpo; a imagem vai junto, como nos outros três templates.
- **E-mail de entrada.** Só vira inline o anexo aceito (regras da T21) que é imagem e cujo `Content-ID` o corpo gravado (novo ou citado) referencia; isso é decidido depois do corte da citação e do fallback para texto. O limite de 5 MB não se aplica (RN-22).
- **Editor.** `@tiptap/extension-image` (aprovada em 16/11/2026), com `allowBase64: false` e o atributo `data-inline-key`; só os formulários de mensagem passam a store de imagens (`useInlineImages`), então respostas prontas e assinatura seguem sem imagem. Imagem colada sem extensão ganha a do tipo (`imagem.png`).
- **Conversa.** Cada `<img data-attachment-id>` é baixada por `fetch` com o token e exibida por `blob:` (URLs liberadas ao desmontar). Na falha, a imagem vira o texto `[alt]`.
- **T21 CT-19 mudou.** E-mail só com uma imagem colada não fica mais com o corpo "(e-mail sem texto)": a imagem é o corpo, como imagem do texto (RN-20). O teste da T21 foi atualizado.
- **E2e só no CI.** Sem Docker nesta máquina, os testes de `inline-images.e2e-spec.ts` e os novos de `notifications` e `inbound-email` rodam pela primeira vez no PR.

## 11. Pendências

- T33 (imagem na assinatura do agente), que reaproveita este mecanismo.
