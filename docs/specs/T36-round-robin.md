# Spec T36 — Distribuição automática (round-robin) por grupo

> Status: pronta · Tarefas: T36 (#60) · Depende de: T08–T10 (criação e `PATCH` de ticket), T14 (outbox), T21 (e-mail de entrada), T25 (Administração → Grupos), T35 (alteração em lote) · Revisada em: 19/11/2026

## 1. Objetivo

Quando um grupo liga a **distribuição automática**, cada chamado novo que entra nele sem responsável é atribuído ao próximo agente do grupo, em rodízio. O agente atribuído recebe um e-mail avisando. O supervisor deixa de distribuir à mão os chamados desse grupo, mas continua podendo reatribuir qualquer um.

## 2. Fora de escopo

- Distribuir pela carga (quem tem menos chamados abertos), por habilidade, por unidade ou por peso: o critério é só o rodízio (decisão 2).
- Marcar agente como "ausente" ou "de férias" para pular a vez. Hoje só sai do rodízio quem sai do grupo, fica inativo ou perde a role de agente (RN-05).
- Redistribuir os chamados que já estão na fila quando a distribuição é ligada. Só os que entram depois (RN-09).
- Redistribuir quando o responsável sai do grupo ou é desligado (02-identidade, "tickets de agente desligado").
- E-mail para atribuições manuais. O aviso novo só sai na atribuição automática (RN-13).
- Chamado aberto por agente em nome de alguém e chamados importados do Freshdesk (decisão 3).

## 3. Fatos externos que esta spec assume

| Fato                                                                                                               | Fonte                          | Confirmar? |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------- |
| O ator do sistema `system@helpdesk.local` existe (seed) e já assina os eventos do fechamento automático (T27)      | 📘 `users/system-user.ts`, T27 | —          |
| Mudar o grupo de um chamado não remove o responsável atual                                                         | 📘 T08–T10 §10 (RN-26)         | —          |
| A alteração em lote (T35) passa pelo mesmo caminho do `PATCH` individual, então herda a regra de "movido de grupo" | 📘 T35 RN-05                   | —          |
| Os grupos têm poucos agentes (2 a 6) e o volume é de ~500 chamados/mês: um lock por grupo na criação não pesa      | 💡 01-escopo                   | —          |

## 4. Regras de negócio

**Configuração**

- **RN-01** — Cada grupo ganha a opção **"Distribuir automaticamente"** (`autoAssign`), desligada por padrão, inclusive nos grupos que já existem. Só o admin altera, em Administração → Grupos, junto com os outros campos do grupo (T25).
- **RN-02** — Grupo inativo não distribui, mesmo com a opção ligada (ele não recebe chamados novos).

**Quando distribuir**

- **RN-03** — Um chamado é distribuído quando, ao fim da operação que o coloca no grupo, ele está **sem responsável**, num grupo **ativo com `autoAssign`**, e a operação é uma destas:
  - (a) criação pelo portal pelo próprio solicitante (`source = portal`);
  - (b) criação pelo canal de e-mail (`source = email`), inclusive quando a caixa do setor define o grupo (#42);
  - (c) mudança de grupo por `PATCH /tickets/:id` ou pela alteração em lote (T35), quando o grupo de destino tem `autoAssign` e o chamado termina a operação sem responsável.
- **RN-04** — Não distribuem: chamado aberto por agente em nome de alguém (`source = agent`), chamado importado (T29), `PATCH` que não muda o grupo, e mudança de grupo de chamado que continua com responsável (RN-26 da T08 mantém o responsável). Também não distribui um `PATCH` que muda o grupo **e** define `assigneeId: null` no mesmo corpo: quem tira o responsável de propósito quer o chamado na fila (decisão 6).

**Quem entra no rodízio**

- **RN-05** — Elegíveis: membros do grupo com usuário **ativo** e role efetiva `agente`, `supervisor` ou `admin`. É a mesma lista de "agentes ativos" usada no aviso ao grupo (T14) e no seletor de responsável. Supervisor e admin só entram se forem membros do grupo.
- **RN-06** — Sem nenhum elegível, o chamado fica sem responsável, como hoje, e a API registra um aviso no log (`Distribuição automática do grupo <id>: nenhum agente elegível`). A operação que criou ou moveu o chamado não falha.

**Ordem do rodízio**

- **RN-07** — A ordem é **alfabética pelo nome** do usuário (empate pelo id), entre os elegíveis do momento. O grupo guarda **quem recebeu por último** (`lastAutoAssigneeId`). O próximo é o primeiro elegível que vem **depois** dele nessa ordem; depois do último da lista, volta ao primeiro.
- **RN-08** — Se quem recebeu por último saiu do rodízio (RN-05), a vez continua de onde ele estaria na ordem alfabética: o próximo é o primeiro elegível cujo nome vem depois do dele. Sem registro de último (grupo recém-ligado), começa pelo primeiro da lista.
- **RN-09** — Ligar ou desligar `autoAssign` não altera chamados existentes nem zera o `lastAutoAssigneeId`.
- **RN-10** — Atribuições manuais não contam para o rodízio: só a distribuição automática atualiza o `lastAutoAssigneeId`.
- **RN-11** — Duas criações simultâneas no mesmo grupo não podem cair no mesmo agente por corrida: a escolha e a atualização do `lastAutoAssigneeId` acontecem na mesma transação do chamado, com lock da linha do grupo (`SELECT … FOR UPDATE`).

**Efeitos**

- **RN-12** — A atribuição automática grava o responsável na mesma transação da criação ou da mudança de grupo e registra um evento `assigned` em `ticket_events` com ator **`system@helpdesk.local`**, `data = { from: null, to: <agente>, reason: 'round_robin' }`. No histórico do chamado aparece como "Atribuído automaticamente a <nome>". A versão do chamado não muda além do que a própria operação já muda: na criação, o chamado nasce com o responsável; na mudança de grupo, a atribuição faz parte do mesmo incremento.
- **RN-13** — O agente atribuído recebe pela outbox o e-mail **`ticket_assigned`**: assunto `[#<número>] Chamado atribuído a você: <assunto>`, com solicitante, unidade, categoria, grupo e o link para o chamado. Não leva o corpo da mensagem (o agente lê no portal). Segue as regras da T14: `Auto-Submitted: auto-generated`, `Message-ID` próprio, só para usuário ativo.
- **RN-14** — O aviso de chamado novo ao grupo (`ticket_created_group`) continua saindo como hoje. Na criação o agente atribuído recebe os dois e-mails (o do grupo, se for membro listado, e o `ticket_assigned`) (decisão 5).
- **RN-15** — O evento de domínio `ticket.assigned` é emitido depois do commit, como numa atribuição manual, com o ator do sistema.
- **RN-16** — Depois da distribuição, respostas do solicitante notificam o responsável, e não o grupo, como já acontece com chamado atribuído (T14 RN-03).

**Tela**

- **RN-17** — Em Administração → Grupos, o formulário do grupo ganha a chave "Distribuir automaticamente" com a ajuda "Chamados novos sem responsável vão para os agentes do grupo, um de cada vez, em ordem alfabética." A lista de grupos mostra "Automática" numa coluna "Distribuição" quando ligada.
- **RN-18** — No histórico do chamado, o evento da RN-12 aparece como "Atribuído automaticamente a <nome>" (sem "por <ator>").

## 5. Contrato da API

Nenhuma rota nova.

**`GET /api/admin/groups`, `POST /api/admin/groups`, `PATCH /api/admin/groups/:id`** (só admin, T25). `GroupItem` ganha `autoAssign: boolean`; `createGroupSchema` e `updateGroupSchema` aceitam `autoAssign?: boolean` (no `create`, ausente = `false`).

**`GET /api/tickets/:id`**: o evento `assigned` pode trazer `data.reason = 'round_robin'`. O tipo de `data` do evento passa a aceitar esse campo; o resto do contrato não muda.

**`POST /api/tickets`, `PATCH /api/tickets/:id`, `PATCH /api/tickets/bulk`**: mesmo contrato. A resposta já reflete o responsável atribuído (o `assignee` no detalhe; na alteração em lote, `changed: true` e a `version` nova, como hoje).

## 6. Dados

Migração `group_auto_assign`:

```sql
ALTER TABLE groups ADD COLUMN auto_assign boolean NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN last_auto_assignee_id uuid NULL
  REFERENCES users(id) ON DELETE SET NULL;
```

Nenhuma alteração em `tickets` nem em `ticket_events` (append-only, só ganha linhas). O template `ticket_assigned` entra em `NOTIFICATION_TEMPLATES` (a coluna `notifications.template` é texto).

## 7. Configuração

Nenhuma variável nova.

## 8. Casos de borda

| Caso                                                                               | Comportamento                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Grupo com `autoAssign` e um só agente elegível                                     | Todos os chamados vão para ele                                                           |
| Grupo com `autoAssign` e nenhum elegível                                           | Chamado sem responsável, aviso no log (RN-06)                                            |
| Último atribuído foi removido do grupo                                             | Próximo pela ordem alfabética a partir do nome dele (RN-08)                              |
| Último atribuído foi excluído do banco (FK `SET NULL`)                             | Recomeça pelo primeiro da lista                                                          |
| Agente renomeado depois de receber                                                 | A ordem usa o nome atual; no máximo um agente recebe duas vezes seguidas ou pula uma vez |
| E-mail de resposta que cai num chamado existente                                   | Não é criação: não distribui                                                             |
| Chamado movido em lote para grupo com `autoAssign`, metade com responsável         | Só os sem responsável são distribuídos, cada um na sua vez                               |
| Chamado movido para grupo com `autoAssign` e, no mesmo `PATCH`, `assigneeId: null` | Não distribui (RN-04)                                                                    |
| Falha ao enfileirar o e-mail `ticket_assigned`                                     | Igual a qualquer enqueue: a transação inteira falha (a outbox grava na mesma transação)  |
| Solicitante que também é agente do grupo abre chamado pelo portal                  | Entra no rodízio normalmente; pode receber o próprio chamado                             |

## 9. Casos de teste

| CT    | Dado                                                                                 | Quando                                                         | Então                                                                                                                      | Cobre                |
| ----- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| CT-01 | —                                                                                    | `createGroupSchema` / `updateGroupSchema` com `autoAssign`     | Aceitam booleano; `updateGroupSchema({ autoAssign: false })` vale sozinho; string é recusada                               | RN-01                |
| CT-02 | `nextAssignee(['Ana','Bia','Caio'], último = null)`                                  | função pura                                                    | Ana                                                                                                                        | RN-07, RN-08         |
| CT-03 | idem, último = Bia; último = Caio                                                    | função pura                                                    | Caio; Ana (volta ao início)                                                                                                | RN-07                |
| CT-04 | elegíveis Ana e Caio, último = Bia (saiu do grupo)                                   | função pura                                                    | Caio                                                                                                                       | RN-08                |
| CT-05 | elegíveis vazios                                                                     | função pura                                                    | `null`                                                                                                                     | RN-06                |
| CT-06 | grupo G1 com `autoAssign`, membros Ana e Bia (agentes ativos)                        | três chamados criados pelo portal pelo solicitante             | Responsáveis Ana, Bia, Ana; `last_auto_assignee_id` = Ana; evento `assigned` com ator do sistema e `reason: 'round_robin'` | RN-03a, RN-07, RN-12 |
| CT-07 | G1 com `autoAssign`                                                                  | e-mail novo processado (driver `folder`)                       | Chamado criado com responsável pelo rodízio                                                                                | RN-03b               |
| CT-08 | G1 com `autoAssign`                                                                  | agente abre chamado em nome do solicitante                     | Chamado sem responsável; `last_auto_assignee_id` inalterado                                                                | RN-04                |
| CT-09 | G1 **sem** `autoAssign`                                                              | chamado pelo portal                                            | Sem responsável                                                                                                            | RN-01                |
| CT-10 | G1 com `autoAssign`, membros: Ana inativa, Bia sem role de agente, Caio agente ativo | chamado pelo portal                                            | Responsável Caio                                                                                                           | RN-05                |
| CT-11 | G1 com `autoAssign` sem nenhum elegível                                              | chamado pelo portal                                            | 201, sem responsável                                                                                                       | RN-06                |
| CT-12 | chamado em G2 sem responsável; G1 com `autoAssign`                                   | `PATCH` `groupId = G1`                                         | Responsável pelo rodízio; eventos `group_changed` e `assigned` (`round_robin`); versão +1                                  | RN-03c, RN-12        |
| CT-13 | chamado em G2 com responsável Pedro; G1 com `autoAssign`                             | `PATCH` `groupId = G1`                                         | Pedro continua responsável; rodízio não anda                                                                               | RN-04                |
| CT-14 | chamado em G2 com responsável; G1 com `autoAssign`                                   | `PATCH` `groupId = G1, assigneeId = null`                      | Sem responsável                                                                                                            | RN-04                |
| CT-15 | três chamados sem responsável em G2; G1 com `autoAssign`, Ana e Bia                  | `PATCH /tickets/bulk` `groupId = G1`                           | Ana, Bia, Ana, na ordem enviada                                                                                            | RN-03c, RN-07        |
| CT-16 | G1 com `autoAssign`, Ana e Bia                                                       | duas criações em paralelo (`Promise.all`)                      | Uma para Ana e outra para Bia                                                                                              | RN-11                |
| CT-17 | chamado distribuído para Ana                                                         | outbox                                                         | Linha `ticket_assigned` para o e-mail de Ana, assunto com `[#n]`; o `ticket_created_group` também foi enfileirado          | RN-13, RN-14         |
| CT-18 | atribuição manual a Ana                                                              | outbox                                                         | Nenhum `ticket_assigned`; `last_auto_assignee_id` inalterado                                                               | RN-10, RN-13         |
| CT-19 | admin                                                                                | `PATCH /admin/groups/:id` `{ autoAssign: true }`, depois `GET` | `autoAssign: true` na lista; agente recebe 403 na mesma rota (matriz já cobre a rota)                                      | RN-01                |
| CT-20 | tela de grupos (admin)                                                               | liga "Distribuir automaticamente" e salva                      | `PATCH` com `autoAssign: true`; a lista mostra "Automática" na coluna Distribuição                                         | RN-17                |
| CT-21 | detalhe do chamado com evento `assigned` `reason: 'round_robin'`                     | agente abre o chamado                                          | Histórico mostra "Atribuído automaticamente a Ana"                                                                         | RN-18                |
| CT-22 | `ticket_assigned` renderizado                                                        | template                                                       | Assunto `[#1042] Chamado atribuído a você: <assunto>`; corpo com grupo, solicitante e link; sem o corpo da mensagem        | RN-13                |

## 10. Decisões tomadas na implementação

_A preencher depois da sessão._

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T36-round-robin.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Decisões

1. **Ativação por grupo**, desligada por padrão (19/11/2026).
2. **Rodízio simples** em ordem fixa, a partir do último que recebeu; nada de carga (19/11/2026).
3. **Distribuem:** criação pelo portal (pelo próprio solicitante) e por e-mail, e mudança de grupo que deixa o chamado sem responsável. **Não distribuem:** chamado aberto por agente e importados (19/11/2026).
4. **E-mail ao responsável** atribuído automaticamente; o aviso ao grupo continua (19/11/2026).
5. **O aviso ao grupo continua** mesmo com o chamado já atribuído (RN-14): o grupo continua vendo a fila e o e-mail do grupo pode ser uma caixa compartilhada (19/11/2026).
6. **`PATCH` que muda o grupo e tira o responsável no mesmo corpo não distribui** (RN-04): quem faz isso quer o chamado na fila (19/11/2026).
7. 💡 Ordem alfabética pelo nome (RN-07), por ser fácil de explicar ao supervisor ("vai em ordem alfabética").
