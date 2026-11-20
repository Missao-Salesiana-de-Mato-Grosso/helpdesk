# Spec T39 — Desativar no help desk quem é desligado no Zitadel

> Status: implementada (20/11/2026) · Tarefas: T39 (#67) · Depende de: T05 (JIT, `zitadel_sub`), T15 (usuário ativo/inativo), T36 (rodízio) · Revisada em: 20/11/2026

## 1. Objetivo

Quando alguém é **desativado, bloqueado ou excluído** no Zitadel, o Zitadel avisa o help desk (Actions v2, webhook assinado) e o help desk marca a pessoa como **inativa** na hora e devolve à fila do grupo os chamados abertos que estavam com ela. Isso automatiza o passo 3 do desligamento no runbook (§5).

## 2. Fora de escopo

- **Reativar sozinho** (decisão 2): reativação continua manual em Administração → Usuários. O controle de quais produtos cada usuário pode usar fica com o módulo de Segurança do **msmt-workspace** (decisão 5), não com este repositório.
- Reagir à remoção de autorização (grant) do projeto: no help desk, sem role a pessoa vira solicitante, e o papel do token já é relido a cada login (T05/T24). Os nomes desses eventos também não foram confirmados no v4.19.5.
- Conferência periódica com a API do Zitadel (decisão 4): sem reenvio, um aviso perdido é coberto pelo passo manual do runbook.
- Apagar dados: o usuário só fica inativo; histórico, mensagens e eventos continuam.
- Configurar o Zitadel: o código chega primeiro; criar o target e as execuções no Zitadel de produção é passo do dono do produto, com confirmação, registrado em `docs/ambientes.md` (§7).

## 3. Fatos externos que esta spec assume

Conferidos no código-fonte do Zitadel na tag **v4.19.5** (versão fixada) e na documentação de Actions v2.

| Fato                                                                                                                                                                                             | Fonte                                           | Confirmar?                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| Eventos: `user.deactivated`, `user.locked`, `user.removed` (e `user.reactivated`, `user.unlocked`, que esta spec ignora)                                                                         | 📘 `internal/repository/user/user.go` (v4.19.5) | —                                                                    |
| O corpo traz `aggregateID` (o id do usuário no Zitadel, que é o `sub` do token), `aggregateType` (`user`), `event_type`, `instanceID`, `resourceOwner`, `created_at`, `userID` (quem fez a ação) | 📘 docs Actions v2 ("Sent information Event")   | ⚠️ conferir o corpo real no Zitadel local antes de ligar em produção |
| Assinatura: cabeçalho `ZITADEL-Signature: t=<unix>,v1=<hex>` (um `v1` por chave durante a rotação), HMAC-SHA256 de `"<unix>.<corpo>"` com a chave do target; tolerância padrão de 300 s          | 📘 `pkg/actions/signing.go` (v4.19.5)           | —                                                                    |
| A chave de assinatura (`signingKey`) só é devolvida ao **criar** o target (ou ao gerar uma nova)                                                                                                 | 📘 docs `ActionService.CreateTarget`            | —                                                                    |
| Webhook: o Zitadel olha o status, ignora o corpo; **não há reenvio** em caso de falha                                                                                                            | 📘 `internal/execution/execution.go` (v4.19.5)  | —                                                                    |
| Criar target e execução exige `action.target.write` / `action.execution.write` (IAM_OWNER)                                                                                                       | 📘 docs da API                                  | —                                                                    |

## 4. Regras de negócio

**Recebimento**

- **RN-01** — Rota pública `POST /api/integrations/zitadel/events` (`@Public()`), que só aceita chamadas com assinatura válida: cabeçalho `ZITADEL-Signature`, HMAC-SHA256 de `"<t>.<corpo bruto>"` com a chave `ZITADEL_ACTIONS_SIGNING_KEY`, comparação em tempo constante, e `t` a no máximo **300 s** do relógio do servidor (para mais ou para menos). Sem cabeçalho, formato inválido, assinatura errada ou fora da janela → `401 INVALID_SIGNATURE`, sem tocar no banco.
- **RN-02** — Sem `ZITADEL_ACTIONS_SIGNING_KEY` configurada, a rota responde `404` (integração desligada), para o deploy poder chegar antes da configuração do Zitadel.
- **RN-03** — Corpo válido mas de um evento que não interessa (outro `event_type`, `aggregateType` diferente de `user`) → `200 { "handled": false }`. Corpo que não é JSON ou sem `aggregateID` → `400 VALIDATION_ERROR`.
- **RN-04** — A rota não registra no log o corpo nem o cabeçalho de assinatura; registra só o tipo do evento e o id interno do usuário afetado.

**Efeito**

- **RN-05** — `user.deactivated`, `user.locked` e `user.removed` (decisão 1): o usuário com `zitadel_sub = aggregateID` fica `active = false`, e o cache de usuários da API é invalidado (o `403 USER_INACTIVE` vale já na próxima requisição, mesmo com token válido). Usuário inexistente no help desk → `200 { "handled": false }`.
- **RN-06** — Idempotente: o mesmo evento recebido de novo (ou um segundo evento, como bloquear e depois excluir) não muda nada além do primeiro, e responde `200`.
- **RN-07** — Os papéis concedidos no app (`app_roles`, T24) **não** são apagados: quem reativar a pessoa decide. Como `active = false` já tira a pessoa do rodízio, das listas de responsável, dos avisos de grupo e dos membros visíveis (T15/T36), nada mais é necessário.
- **RN-08** — Chamados **abertos ou pendentes** em que a pessoa era responsável (decisão 3) perdem o responsável, cada um na sua transação: evento `assigned` com ator `system@helpdesk.local` e `data = { from: <pessoa>, to: null, reason: 'user_deactivated' }`, versão +1. Se o grupo do chamado tem distribuição automática (T36), o rodízio escolhe outro agente na mesma transação (evento e e-mail `ticket_assigned` como na T36). Resolvidos e fechados ficam como estão.
- **RN-09** — Uma falha num chamado não impede os outros nem a desativação (que é gravada antes); o erro vai para o log com o id do chamado.
- **RN-10** — Log de auditoria: `Zitadel <event_type>: usuário <id interno> desativado; N chamado(s) devolvido(s) à fila`.

**Tela**

- **RN-11** — No histórico do chamado, o evento da RN-08 aparece como "Sistema removeu o responsável (Fulano) — desligado no Zitadel".

## 5. Contrato da API

### `POST /api/integrations/zitadel/events`

Pública (sem token), autenticada pela assinatura (RN-01). Sem `@Roles`. Fica fora do limite de requisições padrão por IP? **Não**: mantém o limite global (o Zitadel manda poucos eventos).

Corpo (JSON do Zitadel; só estes campos são lidos):

```json
{ "aggregateID": "336494809936035843", "aggregateType": "user", "event_type": "user.deactivated" }
```

Respostas: `200 { "handled": true | false }`, `400 VALIDATION_ERROR`, `401 INVALID_SIGNATURE`, `404` (integração desligada).

Código novo em `ApiErrorCode`: `INVALID_SIGNATURE`.

## 6. Dados

Nenhuma migração. A verificação da assinatura precisa do **corpo bruto**: a API passa a guardar o `rawBody` das requisições JSON (`NestFactory.create(..., { rawBody: true })`).

## 7. Configuração e operação

- Variável nova `ZITADEL_ACTIONS_SIGNING_KEY` (opcional, segredo). Vazia = integração desligada (RN-02). Chega ao pod pelo mesmo caminho do SMTP: secret do GitHub `ZITADEL_ACTIONS_SIGNING_KEY` → `secrets/zitadel-actions.env` → `deploy/prod/app.sh` → Secret `helpdesk-secrets`. Local: `.env`.
- **Ordem de ativação em produção** (cada passo no Zitadel com confirmação do dono do produto e registrado em `docs/ambientes.md`):
  1. Merge e deploy deste código (rota responde 404).
  2. No Zitadel, criar o target `helpdesk-desligamento`: tipo **webhook** (`restWebhook`, `interruptOnError: false`), endpoint `https://suporte.msmt.org.br/api/integrations/zitadel/events`, timeout `10s`, payload JSON. Guardar a `signingKey` devolvida.
  3. Gravar a chave no secret do GitHub e em `../msmt-infra-automation/secrets/zitadel-actions.env`, e fazer um deploy (re-run do último).
  4. Criar as três execuções por evento (`user.deactivated`, `user.locked`, `user.removed`) apontando para o target.
  5. Testar com um usuário de teste: desativar no Zitadel e conferir no help desk e no log.
- O runbook §5 passa a dizer que o passo 3 é automático quando a integração está ligada, e continua valendo como contingência.

## 8. Casos de borda

| Caso                                                                     | Comportamento                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Help desk fora do ar quando o Zitadel avisa                              | O aviso se perde (sem reenvio): o passo manual do runbook cobre                      |
| Evento de usuário que nunca entrou no help desk                          | `200 handled: false`                                                                 |
| Admin desligado no Zitadel                                               | Fica inativo como qualquer um; o admin da instância (break-glass) não depende do app |
| Usuário criado pelo canal de e-mail, sem `zitadel_sub`                   | Não é achado pelo evento (não há como): `handled: false`                             |
| Rotação da chave (dois `v1` no cabeçalho)                                | Vale se **qualquer** `v1` bater com a chave configurada                              |
| Chamado do desligado em grupo com rodízio e nenhum outro agente elegível | Fica sem responsável (T36 RN-06)                                                     |
| Corpo grande ou malformado                                               | Limite de corpo padrão da API; JSON inválido → 400                                   |

## 9. Casos de teste

| CT    | Dado                                                                        | Quando                                            | Então                                                                                                                                                | Cobre        |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| CT-01 | chave `k`, corpo `b`, `t` agora                                             | `verifyZitadelSignature` (pura)                   | Válida com `t=<t>,v1=<hmac>`; válida com dois `v1` (um certo); inválida com corpo alterado, chave errada, `t` a 301 s, cabeçalho vazio ou sem `v1`   | RN-01        |
| CT-02 | integração ligada                                                           | `POST` sem cabeçalho ou com assinatura errada     | 401 INVALID_SIGNATURE; usuário continua ativo                                                                                                        | RN-01        |
| CT-03 | sem `ZITADEL_ACTIONS_SIGNING_KEY`                                           | `POST`                                            | 404                                                                                                                                                  | RN-02        |
| CT-04 | `ag1` ativo, com chamados abertos e um resolvido                            | `user.deactivated` assinado para o `sub` de `ag1` | 200 `handled: true`; `ag1.active = false`; abertos sem responsável, com evento do sistema `reason: user_deactivated`; o resolvido continua com `ag1` | RN-05, RN-08 |
| CT-05 | idem                                                                        | `user.locked` e `user.removed`                    | Mesmo efeito                                                                                                                                         | RN-05        |
| CT-06 | `ag1` já inativo                                                            | mesmo evento de novo                              | 200; nada muda; nenhum evento novo                                                                                                                   | RN-06        |
| CT-07 | chamado de `ag1` num grupo com distribuição automática e outro agente ativo | `user.deactivated`                                | O chamado vai para o outro agente (eventos `assigned` com `user_deactivated` e `round_robin`)                                                        | RN-08        |
| CT-08 | `sub` desconhecido; `event_type = user.human.added`; `aggregateType = org`  | `POST` assinado                                   | 200 `handled: false`; nada muda                                                                                                                      | RN-03, RN-05 |
| CT-09 | corpo assinado que não é JSON ou sem `aggregateID`                          | `POST`                                            | 400                                                                                                                                                  | RN-03        |
| CT-10 | `ag1` desativado pelo evento com token ainda válido                         | `ag1` chama `GET /api/me`                         | 403 USER_INACTIVE (cache invalidado)                                                                                                                 | RN-05        |
| CT-11 | matriz de permissões                                                        | rota sem assinatura, para cada papel              | 401 para todos (a rota não usa o token)                                                                                                              | RN-01        |
| CT-12 | histórico com o evento da RN-08                                             | `eventText` (web)                                 | "removeu o responsável (Ana) — desligado no Zitadel"                                                                                                 | RN-11        |

## 10. Decisões tomadas na implementação

- **Módulo:** `integrations` (controller + service). A verificação da assinatura é uma função pura (`integrations/zitadel-signature.ts`), espelho do `pkg/actions/signing.go` do v4.19.5; `signZitadelPayload` monta o cabeçalho como o Zitadel, para os testes.
- **Corpo bruto:** `rawBody: true` no `NestFactory.create` (e no app dos testes). A assinatura é conferida sobre esses bytes, e o JSON é lido de novo deles com um schema zod que só pega `aggregateID`, `aggregateType` e `event_type` (o formato de `event_payload` diverge entre as páginas da documentação, e a spec não precisa dele).
- **Responsabilidades:** `UsersService.deactivateBySub` inativa (sem mexer nos papéis do app); `TicketsService.releaseAssignedTickets` devolve os chamados, com a mesma trava por chamado e o mesmo ator do sistema do fechamento automático (T27), e reaproveita o rodízio da T36.
- **Cache:** o service invalida o `UserCache` pelo `sub`, como a tela de usuários faz, para o `403 USER_INACTIVE` valer na hora (CT-10).
- **CT-03:** "sem chave, 404" virou teste unitário do service (`zitadel-events.service.spec.ts`): a suíte e2e sobe todas as aplicações com a mesma chave (`vitest.config.e2e.ts`), e a configuração é lida uma vez.
- **Deploy:** `ZITADEL_ACTIONS_SIGNING_KEY` entra pelo secret do GitHub → `secrets/zitadel-actions.env` → `deploy/prod/app.sh` → `helpdesk-secrets`, só quando preenchida. Runbook §18 (ligar, diagnosticar, desligar), §5 (passos 3 e 4) e §6 (rotação da chave); tabela de segredos em `docs/ci-cd.md`.
- **Não foi feito nada no Zitadel.** A configuração de produção segue o runbook §18, com confirmação do dono do produto, e cada passo vai para `docs/ambientes.md`. Antes, vale conferir no Zitadel local o corpo real do evento (§3).
- **Testes:** CT-01 em `zitadel-signature.spec.ts`; CT-02 e CT-04 a CT-10 em `test/zitadel-events.e2e-spec.ts` (rodam só no CI); CT-11 na matriz de permissões; CT-12 em `event-text.test.ts`.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T39-desligamento-zitadel.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Decisões

1. **Desativam:** desativar, bloquear e excluir no Zitadel (20/11/2026).
2. **Não reativa sozinho** (20/11/2026).
3. **Chamados abertos e pendentes voltam para a fila do grupo**; com distribuição automática, o rodízio redistribui (20/11/2026).
4. **Só o webhook**, sem conferência periódica; o runbook continua como contingência (20/11/2026).
5. **A ativação de produtos por usuário deve ser gerida no msmt-workspace**, por um admin do workspace (módulo de Segurança), e não em cada produto (20/11/2026). Fica como pendência do workspace; este repositório não muda por isso.
6. 💡 Tipo **webhook** e não async: o Zitadel registra no log dele quando o help desk responde erro, o que ajuda a diagnosticar; com `interruptOnError: false`, uma falha aqui não atrapalha a ação no Zitadel.
