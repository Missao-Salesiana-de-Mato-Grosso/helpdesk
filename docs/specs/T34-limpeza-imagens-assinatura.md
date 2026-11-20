# Spec T34 — Limpeza das imagens que saem da assinatura

> Status: implementada (19/11/2026) · Tarefas: T34 (#52, #61) · Depende de: T33 (imagem na assinatura), T14 (outbox) · Revisada em: 20/11/2026

## 1. Objetivo

Apagar automaticamente as imagens da assinatura que ninguém mais usa: nem a assinatura atual do dono, nem um e-mail que ainda pode sair. Resolve a pendência da T33 (RN-08).

## 2. Fora de escopo

- Tela, botão ou rota para apagar imagens.
- Arquivos de usuários apagados do banco (usuários não são apagados; a lixeira da T22 é soft delete).
- Anexos de mensagens (T13, T32): nunca são apagados.

## 3. Fatos externos que esta spec assume

| Fato                                                                                       | Fonte                                 | Confirmar? |
| ------------------------------------------------------------------------------------------ | ------------------------------------- | ---------- |
| Só `pending` é lido de novo pelo envio; `failed` pode voltar a `pending` pelo runbook (§9) | 💡 T14, `docs/runbook.md`             | —          |
| Sem o arquivo no storage, o e-mail sai só com o texto da assinatura                        | 💡 T33 RN-12                          | —          |
| `delete` do storage é idempotente nos drivers `local` e `s3`                               | 💡 `apps/api/src/attachments/storage` | —          |
| Pedido do dono do produto em 19/11/2026                                                    | 💡 #52                                | —          |

## 4. Regras de negócio

- **RN-01** — Uma imagem da assinatura é **apagável** quando, ao mesmo tempo:
  - não aparece (`data-signature-image-id`) na assinatura atual do dono;
  - não aparece em `signatureImages` de nenhuma notificação `pending` ou `failed`;
  - foi criada há mais de **24 horas**.
- **RN-02** — Um job diário, às **3h30 no fuso de Cuiabá** (`America/Cuiaba`), apaga as imagens apagáveis, no máximo **200 por execução** (o resto fica para o dia seguinte).
- **RN-03** — Para cada imagem: apaga o arquivo do storage e depois a linha. Se o storage falhar, a linha fica e a imagem volta na próxima execução; as outras seguem.
- **RN-04** — Uma execução não começa enquanto a anterior está rodando. Erro de banco encerra a execução com log, sem derrubar a API.
- **RN-05** — Toda execução escreve uma linha de log com as contagens (apagadas, com falha), inclusive quando são zero, para mostrar que o job rodou. Só contagens: nunca o nome do arquivo, a chave no storage nem o conteúdo.
- **RN-06** — Notificações `sent` não seguram imagem nenhuma.

## 5. Contrato da API

Sem mudança: nenhuma rota nova.

## 6. Dados

Sem migração. Usa `signature_images`, `users.signature_html` e `notifications` (status, template e payload).

## 7. Configuração

Nenhuma variável nova. Constantes no código: horário (3h30), fuso (`America/Cuiaba`), lote (200) e folga (24 h).

## 8. Casos de borda

| Caso                                    | Comportamento                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Imagem trocada há 5 minutos             | Só sai depois de 24 h da criação dela (RN-01).                                                     |
| E-mail `failed` que referencia a imagem | A imagem fica até o e-mail sair ou a linha ser apagada.                                            |
| Imagem já sem arquivo no storage        | O `delete` é idempotente: a linha é apagada.                                                       |
| Duas instâncias da API                  | Cada uma roda o job; o `delete` idempotente e o `deleteMany` por id tornam a repetição inofensiva. |
| Assinatura apagada (nula)               | Todas as imagens do usuário viram candidatas (respeitando RN-01).                                  |

## 9. Casos de teste

**API (e2e)**

- **CT-01** (RN-01, RN-03) — Imagem que saiu da assinatura, criada há mais de 24 h, sem e-mail pendente: o arquivo e a linha somem.
- **CT-02** (RN-01) — Imagem ainda na assinatura atual: fica.
- **CT-03** (RN-01, RN-06) — Imagem fora da assinatura mas em `signatureImages` de um `reply` `pending`, e outra de um `failed`: ficam. Referenciada só por um `sent`: é apagada.
- **CT-04** (RN-01) — Imagem fora da assinatura criada há menos de 24 h: fica.
- **CT-05** (RN-03) — Falha do storage numa imagem: a linha dela fica e as outras são apagadas.
- **CT-06** (RN-05) — O log da execução não contém a chave no storage nem o nome do arquivo.

**API (unitário)**

- **CT-07** (RN-04) — O cron não começa outra execução enquanto uma está rodando, e um erro não escapa do `tick`.
- **CT-08** (RN-05) — Uma execução sem nada para apagar loga `0 apagada(s), 0 com falha no storage`.
- **CT-09** (RN-02) — O cron está declarado às 3h30 com o fuso `America/Cuiaba`.

## 10. Decisões tomadas na implementação

- **Onde.** `SignatureService.deleteUnusedImages` faz a seleção e a remoção; `SignatureImagesCron` (módulo `users`) agenda e loga. O `AttachmentsService` ganhou `deleteObject`, que lança na falha e não loga (o `discard` existente loga a chave no storage, o que RN-05 proíbe aqui).
- **Seleção em memória.** As candidatas (criadas há mais de 24 h) são filtradas no código contra a assinatura do dono e os payloads dos `reply` `pending`/`failed`, lidos com checagem de formato. No volume do helpdesk (poucas imagens, poucos e-mails pendentes) isso dispensa consulta em `jsonb`.
- **Revisão de 20/11/2026 (#61).** Na primeira execução em produção o job não logou nada (só logava quando apagava algo) e rodou às 3h30 UTC, 23h30 em Cuiabá, porque o container não define fuso. Agora loga em toda execução e declara `timeZone: 'America/Cuiaba'`. O fuso é fixo no código porque o `@Cron` só aceita valor estático; ler o `BUSINESS_TIMEZONE` exigiria registrar o job à mão com o pacote `cron`, uma dependência direta nova. O valor é o mesmo padrão do `BUSINESS_TIMEZONE`.
- **Remoção da linha com `deleteMany` por id**, para uma segunda instância que chegue depois não falhar.
- **E2e só no CI**, como nas tarefas anteriores.

## 11. Pendências

Nenhuma.
