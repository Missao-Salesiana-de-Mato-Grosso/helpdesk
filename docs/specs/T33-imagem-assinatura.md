# Spec T33 — Imagem na assinatura do agente

> Status: implementada (18/11/2026) · Tarefas: T33 (#50) · Depende de: T31 (assinatura), T32 (imagens no texto) · Revisada em: 18/11/2026

## 1. Objetivo

O agente pode pôr imagens (por exemplo, o logo da unidade) na própria assinatura de e-mail, em "Minha assinatura". No e-mail `reply` da resposta escrita no portal, a imagem vai embutida, como as imagens do texto da T32.

## 2. Fora de escopo

- Assinatura padrão da organização ou por grupo; admin editar a assinatura de outro usuário (T31 §2).
- Redimensionar ou cortar a imagem no portal. A largura exibida no e-mail é limitada (RN-12).
- Imagem por URL externa digitada.
- Limpeza automática das imagens que saíram da assinatura (RN-08).
- Mudar onde a assinatura entra: só o `reply` escrito no portal (T31 RN-08), nada muda nisso.

## 3. Fatos externos que esta spec assume

| Fato                                                                         | Fonte                                | Confirmar? |
| ---------------------------------------------------------------------------- | ------------------------------------ | ---------- |
| Embutir por `Content-ID` já funciona na saída (`nodemailer`, `cid`)          | 💡 T32 RN-15, em produção            | —          |
| A assinatura é congelada no payload da outbox no enqueue                     | 💡 T31 RN-09, T14 RN-10              | —          |
| O editor do portal já insere imagem por `data-inline-key` com prévia `blob:` | 💡 T32 RN-23 a RN-25                 | —          |
| Limites: até 2 imagens, PNG ou JPG, até 200 KB cada                          | 💡 dono do produto, 18/11/2026 (#50) | —          |
| Nenhuma dependência nova                                                     | 💡                                   | —          |

## 4. Regras de negócio

### Cadastro

- **RN-01** — Uma imagem da assinatura pertence ao usuário (`signature_images`, com o dono) e fica no mesmo storage dos anexos. Não pertence a mensagem nenhuma.
- **RN-02** — Tipos: `png`, `jpg`/`jpeg` (pela extensão). Outro tipo → 415 `UNSUPPORTED_FILE_TYPE`.
- **RN-03** — Cada imagem tem no máximo **200 KB**. Acima → 413 `FILE_TOO_LARGE`.
- **RN-04** — A assinatura gravada referencia no máximo **2 imagens**. Acima → 422 `VALIDATION_ERROR`.
- **RN-05** — O HTML gravado referencia a imagem como `<img data-signature-image-id="<id>" alt="…">`, sem `src`. A allowlist da assinatura (T31 RN-04) passa a aceitar `img` **só nessa forma**: `src` de qualquer tipo, `data-attachment-id` e `data-signature-image-id` de outro usuário ou inexistente são descartados.
- **RN-06** — Ao salvar, imagem nova vem como na T32 (`<img data-inline-key>` + arquivo no campo `inline`); imagem que já estava na assinatura vem com o `data-signature-image-id` dela e é mantida se for do próprio usuário. Imagem enviada e não referenciada não é gravada.
- **RN-07** — Assinatura só com imagem, sem texto, é válida (deixa de ser tratada como vazia; muda T31 RN-05 e CT-17).
- **RN-08** — Imagem que sai da assinatura continua no storage e no banco: um e-mail pendente pode referenciá-la (RN-11). A limpeza fica para outra tarefa.
- **RN-09** — Cada usuário só vê as próprias imagens: `GET /api/me/signature/images/:id` de imagem de outro usuário ou inexistente → 404. Só agentes acessam (T31 RN-02).

### E-mail

- **RN-10** — No `reply` escrito no portal, cada imagem da assinatura vai embutida: `<img src="cid:sig-<id>@<domínio dos Message-IDs>">`, com largura máxima de 300 px.
- **RN-11** — O payload congela, junto com `signatureHtml`, os dados de cada imagem referenciada (`signatureImages`: id, chave no storage, nome, tipo, tamanho). Trocar a assinatura depois do enqueue não muda o e-mail pendente (T31 RN-09).
- **RN-12** — As imagens da assinatura entram no teto `NOTIFICATIONS_MAX_ATTACHMENT_BYTES` antes das imagens do texto e dos anexos comuns (T32 RN-17). Se não couberem, ou se alguma não estiver no storage, as imagens da assinatura são omitidas sem aviso; o texto da assinatura continua.
- **RN-13** — Na versão em texto do e-mail, as imagens da assinatura não aparecem (sem `[imagem]`).
- **RN-14** — Payload anterior à T33 (sem `signatureImages`) renderiza como antes.

### Tela

- **RN-15** — "Minha assinatura" ganha o botão "Inserir imagem" (e colar e arrastar), com as regras de RN-02 a RN-04 conferidas na hora, com mensagem.
- **RN-16** — Ao abrir a tela, as imagens da assinatura salva aparecem no editor e na prévia, baixadas com o token (RN-09).

## 5. Contrato da API

### `PUT /api/me/signature`

Passa a aceitar também `multipart/form-data`: campo `data` com o JSON (`signatureHtml`, `inlineImages?`) e campo `inline` com os arquivos, na ordem de `inlineImages`. JSON puro continua valendo. Erros novos: 415, 413 e 422 de RN-02 a RN-04; quantidade de arquivos diferente de `inlineImages` → 422 `VALIDATION_ERROR`.

`inlineImages`: mesmo formato da T32, com no máximo 2 chaves.

### `GET /api/me/signature/images/:id` (nova)

Agente; devolve o arquivo da própria imagem (`Content-Disposition: attachment`, `nosniff`, `Cache-Control: private, no-store`, como o download de anexo). Outra pessoa ou id inexistente → 404.

### Contrato interno

- Payload da outbox: `signatureImages?: { id, storageKey, filename, mimeType, sizeBytes }[]`, só no `reply` com assinatura.

## 6. Dados

Tabela `signature_images`: `id uuid`, `user_id uuid` (FK `users`, cascade), `storage_key`, `filename`, `mime_type`, `size_bytes`, `created_at`. Índice em `user_id`.

## 7. Configuração

Nenhuma variável nova. Constantes em `packages/shared`: `SIGNATURE_IMAGE_MAX_BYTES` (200 KB), `SIGNATURE_IMAGE_MAX_FILES` (2), extensões aceitas.

## 8. Casos de borda

| Caso                                                                           | Comportamento                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Agente remove a imagem e salva                                                 | A imagem some da assinatura; o arquivo fica (RN-08).       |
| Agente cola na assinatura o HTML de outra pessoa com `data-signature-image-id` | Id de outro usuário é descartado (RN-05).                  |
| Duas imagens mantidas + uma nova                                               | 3 referências → 422 (RN-04).                               |
| Assinatura antiga só com texto                                                 | Nada muda.                                                 |
| Imagem da assinatura sumiu do storage antes do envio                           | E-mail sai sem as imagens da assinatura (RN-12).           |
| Resposta pelo Gmail (T21)                                                      | Sem assinatura do helpdesk, com ou sem imagem (T31 RN-08). |

## 9. Casos de teste

**API (e2e)**

- **CT-01** (RN-01, RN-05, RN-06) — PUT multipart com texto e uma imagem PNG: 200; `signatureHtml` com `data-signature-image-id` do registro criado, sem `src`; arquivo no storage.
- **CT-02** (RN-06) — Salvar de novo mantendo a imagem pelo id e trocando o texto: a imagem continua, sem novo registro.
- **CT-03** (RN-05, RN-09) — `data-signature-image-id` de outro usuário e `<img src>`: descartados. GET da imagem de outro usuário → 404; da própria → 200.
- **CT-04** (RN-02, RN-03) — `.gif` → 415; PNG de 200 KB + 1 byte → 413; nada gravado.
- **CT-05** (RN-04) — 3 imagens referenciadas → 422.
- **CT-06** (RN-07) — Assinatura só com imagem: gravada.
- **CT-07** (RN-10, RN-11, RN-13) — Resposta pelo portal de agente com logo na assinatura: payload com `signatureImages`; e-mail com `cid:sig-…` e o arquivo embutido; texto sem `[imagem]`.
- **CT-08** (RN-11) — Trocar a assinatura depois do enqueue: o e-mail sai com a imagem antiga.
- **CT-09** (RN-12) — Imagens da assinatura acima do teto: e-mail com o texto da assinatura e sem as imagens dela.
- **CT-10** (RN-02) — Matriz de permissões: `GET /api/me/signature/images/:id` só para agentes.

**API (unitário)**

- **CT-11** (RN-05, RN-07) — Sanitizador da assinatura: aceita só `img` resolvida; descarta `src`, ids desconhecidos; imagem sozinha é conteúdo.
- **CT-12** (RN-10, RN-12, RN-13, RN-14) — Render: `cid` com largura limitada no HTML, imagem omitida quando não embutida, nada no texto, payload antigo igual.

**Shared**

- **CT-13** (contrato) — `inlineImages` na assinatura aceita até 2 chaves.

**Web**

- **CT-14** (RN-15) — Inserir imagem e salvar manda multipart com `inline` e `inlineImages`; a 3ª imagem e GIF são recusados com mensagem.
- **CT-15** (RN-16) — Ao abrir, a imagem salva é baixada com o token e aparece na prévia.

## 10. Decisões tomadas na implementação

- **`SignatureService` no módulo `users`.** A leitura e a gravação da assinatura saíram do `UsersService` para ele, que também guarda as imagens (usa o `AttachmentsService` para o storage; o `UsersModule` passou a importar o `AttachmentsModule`). O `NotificationService` lê assinatura e imagens por ele.
- **Ids gerados na aplicação**, como na T32: o servidor gera o id da imagem nova antes de sanitizar, porque a assinatura gravada já o referencia.
- **Imagem salva vem com o id e um `src` `blob:`.** O editor precisa de `src` para mostrar a imagem; o servidor descarta `src` e `style` e mantém só o `data-signature-image-id` do próprio usuário.
- **Tela.** O editor e a prévia esperam as imagens salvas serem baixadas (com o token) antes de montar. Depois de salvar, o formulário monta de novo com o que o servidor gravou, para a imagem nova passar a ser referenciada pelo id e não subir outra vez. As URLs `blob:` só são liberadas ao sair da tela.
- **Teto.** As imagens da assinatura entram primeiro; se o grupo não couber, cada grupo seguinte disputa o que sobrou do teto, como na T32. Assinatura só com imagens que não foram embutidas sai sem o bloco de assinatura.
- **Download da imagem.** `Content-Disposition: attachment; filename="assinatura"` (o nome original não importa para quem baixa a própria imagem).
- **Matriz de permissões.** A linha nova usa um id inexistente: agentes recebem 404 (passaram pelo `@Roles`), solicitante e pendente 403.
- **E2e só no CI**, como na T31 e na T32.

## 11. Pendências

- Limpeza das imagens que saíram da assinatura e não são mais referenciadas por e-mails pendentes (RN-08).
