# Spec T35 — Ações em lote na lista de chamados

> Status: rascunho · Tarefas: T35 (#55) · Depende de: T08–T10 (`PATCH /tickets/:id`), T11 (fila do agente), T14 (notificações) · Revisada em: 19/11/2026

## 1. Objetivo

Na fila de chamados, o agente, supervisor ou admin marca vários chamados da página atual e aplica a todos, de uma vez, a alteração de **um** campo: situação (inclusive fechar), prioridade, grupo, responsável, categoria ou unidade. Cada chamado passa exatamente pelas regras da alteração individual. Os que podem ser alterados são alterados, e a tela diz quais não foram e por quê.

## 2. Fora de escopo

- Responder ou escrever nota interna em lote, mesclar chamados e excluir chamados.
- Ações em lote para o solicitante ("Meus chamados" não ganha seleção).
- Alterar dois ou mais campos na mesma operação (decidido em 19/11/2026, RN-03).
- Marcar todos os resultados do filtro além da página atual (decidido em 19/11/2026).
- Gravar a unidade também no solicitante (`applyCompanyToRequester`, T08–T10 RN-28): em lote, a unidade muda só no chamado (decidido em 19/11/2026).
- Desfazer uma operação em lote. Cada chamado alterado pode ser corrigido pela tela dele, como hoje.
- Processamento em segundo plano ou fila de jobs: a operação é síncrona (até 100 chamados, RN-02).

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                     | Fonte                          | Confirmar? |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------- |
| `TicketsService.update` já aplica escopo, `version`, transições, unidade obrigatória, eventos, SLA e o e-mail `resolved` | 💡 T08–T10 RN-21 a RN-30, T14  | —          |
| A fila do agente mostra 25 chamados por página (`QUEUE_PAGE_SIZE`) e a API aceita `pageSize` até 100                     | 💡 `apps/web`, shared          | —          |
| `TicketSummary` (item da lista) **não** traz `version` hoje                                                              | 💡 `packages/shared`           | —          |
| O Nest casa as rotas na ordem em que são declaradas: `PATCH /tickets/bulk` precisa vir antes de `PATCH /tickets/:id`     | 📘 NestJS (roteamento Express) | —          |
| Limite, concorrência, unidade e alcance do "selecionar todos" foram decididos pelo dono do produto em 19/11/2026 (#55)   | 💡 discovery                   | —          |
| Nenhuma dependência nova                                                                                                 | 💡                             | —          |

## 4. Regras de negócio

### Pedido

- **RN-01** — Só `agente`, `supervisor` e `admin` (papel efetivo) usam a ação em lote. Os demais recebem 403 `FORBIDDEN_ROLE`; pendente recebe o bloqueio da T22.
- **RN-02** — Um pedido traz de **1 a 100** chamados, cada um com o `id` e o `version` que o agente viu. Lista vazia, acima de 100, `id` repetido ou `id` que não é UUID → 422 `VALIDATION_ERROR`, nada é alterado.
- **RN-03** — O pedido altera **exatamente um campo**, entre `status`, `priority`, `groupId`, `assigneeId` (ou `null` para tirar o responsável), `categoryId` e `companyId`. Nenhum campo, dois ou mais campos, ou campo fora dessa lista (inclusive `applyCompanyToRequester`) → 422 `VALIDATION_ERROR`. Para mudar duas coisas, o agente faz duas operações (decidido em 19/11/2026: combinar campos deixa a operação ampla demais e sujeita a erro).
- **RN-04** — Grupo, categoria e unidade do pedido são conferidos **uma vez, antes** de alterar qualquer chamado. Inexistente ou inativo → 422 `INACTIVE_REFERENCE` para o pedido inteiro, nada é alterado.

### Por chamado

- **RN-05** — Cada chamado é alterado na **sua própria transação**, com as mesmas regras do `PATCH /tickets/:id` (T08–T10 RN-22 a RN-29): escopo de visibilidade, `version`, transições permitidas, chamado fechado imutável, unidade obrigatória para resolver ou fechar, responsável membro do grupo do chamado, SLA recalculado, um `ticket_events` por campo efetivamente alterado e os eventos de domínio.
- **RN-06** — A falha de um chamado **não desfaz nem impede** os outros. Os chamados são processados um de cada vez, na ordem do pedido.
- **RN-07** — Chamado com `version` diferente da atual não é alterado e volta como falha `VERSION_CONFLICT` (decidido em 19/11/2026). Não existe "aplicar por cima".
- **RN-08** — Chamado inexistente ou fora do escopo do ator volta como falha `NOT_FOUND`, sem número nem assunto, para não revelar que existe (mesma regra do 404 individual).
- **RN-09** — Chamado em que nada muda (todos os campos já têm o valor pedido) conta como **sucesso sem alteração**: não incrementa `version`, não gera evento nem notificação (T08–T10 RN-29).
- **RN-10** — Os eventos ficam iguais aos da alteração individual: mesmo `type`, `data = { from, to }`, ator e IP do pedido. O histórico do chamado não distingue a alteração em lote.

### Notificações

- **RN-11** — Cada chamado gera as mesmas notificações da alteração individual, pela outbox: um e-mail `resolved` por chamado que entrou em `resolved`, e os avisos que hoje saem de `ticket.assigned` e `ticket.status_changed`. Fechar direto (`closed`) não envia e-mail, como hoje.
- **RN-12** — Nunca logar corpo de mensagem nem dados do solicitante. O log do pedido traz só o ator, o total de chamados, os campos pedidos (nomes, não valores) e as contagens de sucesso e falha.

### Resposta

- **RN-13** — Pedido válido responde **200** mesmo que todos os chamados falhem. A resposta traz um resultado por chamado, na ordem do pedido, e os totais.
- **RN-14** — Resultado de sucesso traz `id`, `number`, `changed` (se algo mudou) e o `version` novo. Resultado de falha traz `id`, o `code` do `ApiErrorCode` e a `message` em pt-BR; `number` vem só quando o chamado está no escopo (RN-08).

### Tela

- **RN-15** — A fila do agente ganha uma coluna de caixas de seleção. A do cabeçalho marca ou desmarca **todos os chamados da página atual** (decidido em 19/11/2026) e fica indeterminada quando só parte está marcada. Clicar na caixa não abre o chamado.
- **RN-16** — Trocar de página, de filtro, de ordenação ou de busca **limpa a seleção**. A seleção nunca contém chamados que não estão na tela. A seleção guarda só os `id`; o `version` de cada chamado é lido da lista carregada no momento de enviar.
- **RN-17** — Com ao menos um chamado marcado, aparece uma barra de ações com "N selecionado(s)", o botão **Limpar seleção**, o atalho **Fechar** e o botão **Alterar…**.
- **RN-18** — **Alterar…** abre um formulário em dois passos: primeiro o agente escolhe **o que** alterar (Situação, Prioridade, Grupo, Responsável, Categoria ou Unidade, uma opção só), depois o novo valor. Trocar a opção descarta o valor escolhido antes. O botão **Aplicar** só habilita com a opção e o valor escolhidos. Não há opção de aplicar a unidade ao solicitante.
- **RN-19** — **Responsável:** as opções são "Ninguém", "Eu" e os membros do grupo comum a todos os marcados. Se os marcados têm grupos diferentes, só "Ninguém" e "Eu" aparecem; para atribuir a outra pessoa, o agente move os chamados de grupo antes, numa operação separada. A validação final é da API (RN-05).
- **RN-20** — Antes de enviar, uma confirmação resume a alteração: "Alterar a situação de N chamados para Fechado?". **Fechar** também pede confirmação e avisa que chamado fechado não pode mais ser alterado.
- **RN-21** — Depois da resposta, a tela mostra "X alterado(s)" e, se houver falhas, a lista "#número — motivo" (ou "Chamado não encontrado ou fora do seu acesso", RN-08). A lista e os contadores da fila são recarregados, e **todos os chamados marcados que continuam na página** (alterados ou não) seguem marcados, já com o `version` novo da lista. Assim o agente encadeia a operação seguinte (ex.: mover de grupo e depois atribuir) sem marcar de novo. Os que saíram da página (mudaram de filtro ou de escopo) saem da seleção.
- **RN-22** — Mensagens das falhas em pt-BR, pelo `code`: `VERSION_CONFLICT` "alterado por outra pessoa; confira e tente de novo", `TICKET_CLOSED` "já está fechado", `INVALID_TRANSITION` "não pode ir de {de} para {para}", `COMPANY_REQUIRED` "sem unidade; defina a unidade para resolver ou fechar", `ASSIGNEE_NOT_IN_GROUP` "o responsável não é do grupo do chamado", `NOT_FOUND` "não encontrado ou fora do seu acesso". Outro código usa a `message` da API.

## 5. Contrato da API

### `PATCH /api/tickets/bulk`

- Papéis: `agente`, `supervisor`, `admin`. Solicitante → 403 `FORBIDDEN_ROLE`; pendente → bloqueio da T22; anônimo → 401.
- Declarada **antes** de `PATCH /api/tickets/:id`.
- Corpo (`bulkUpdateTicketsSchema`, estrito):

```json
{
  "tickets": [
    { "id": "3f6c…", "version": 4 },
    { "id": "9a01…", "version": 1 }
  ],
  "changes": { "status": "closed" }
}
```

`changes` traz **exatamente um** destes campos: `status`, `priority`, `groupId`, `assigneeId` (`uuid | null`), `categoryId`, `companyId` (RN-03).

- 200:

```json
{
  "results": [
    { "id": "3f6c…", "ok": true, "number": 1042, "changed": true, "version": 5 },
    { "id": "9a01…", "ok": false, "number": 1050, "code": "COMPANY_REQUIRED", "message": "…" },
    { "id": "77be…", "ok": false, "code": "NOT_FOUND", "message": "…" }
  ],
  "succeeded": 1,
  "failed": 2
}
```

- 422 `VALIDATION_ERROR`: RN-02 e RN-03.
- 422 `INACTIVE_REFERENCE`: RN-04.

Nenhum código novo em `ApiErrorCode`. `PATCH /api/tickets/:id` não muda.

### `GET /api/tickets` (alteração)

- `TicketSummary` ganha `version: number`, para a fila enviar o `version` que o agente viu (RN-07).

### Contrato interno (sugestão)

```ts
// packages/shared
export const MAX_BULK_TICKETS = 100;
export const bulkUpdateTicketsSchema = z.object({ tickets, changes }).strict();
export type BulkUpdateResult = BulkUpdateSuccess | BulkUpdateFailure;

// TicketsService: reaproveita update() por chamado, convertendo ApiException em falha.
bulkUpdate(actor, input, ip): Promise<BulkUpdateTicketsResponse>;
```

O `update` individual devolve o detalhe do chamado; o lote não precisa dele. A sessão pode separar o miolo do `update` (transação e regras) da montagem da resposta, desde que o `PATCH /:id` continue idêntico.

## 6. Dados

Nenhuma migração. `tickets.version` já existe; só passa a ser lido na listagem.

## 7. Configuração

Nenhuma variável nova. O limite é a constante `MAX_BULK_TICKETS = 100` em `packages/shared`.

## 8. Casos de borda

| Situação                                                             | Comportamento                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Selecionados incluem chamado já fechado                              | Esse falha com `TICKET_CLOSED`; os outros seguem                                                                   |
| "Fechar" com chamados sem unidade                                    | Os sem unidade falham com `COMPANY_REQUIRED`; os outros fecham                                                     |
| "Resolver" em lote                                                   | Um e-mail `resolved` por chamado resolvido (RN-11)                                                                 |
| Outra pessoa respondeu um dos chamados com a seleção aberta          | A resposta incrementa o `version` (T08–T10): esse falha com `VERSION_CONFLICT`                                     |
| Mesmo chamado aparece duas vezes no pedido                           | 422 `VALIDATION_ERROR` (RN-02), nada é alterado                                                                    |
| Agente move chamados para um grupo do qual não é membro              | Permitido (T08–T10 RN-27); depois de recarregar, eles somem da fila dele                                           |
| Pedido com grupo e responsável juntos                                | 422 `VALIDATION_ERROR` (RN-03): são duas operações, primeiro o grupo, depois o responsável                         |
| Grupo de destino desativado entre abrir o formulário e aplicar       | 422 `INACTIVE_REFERENCE` para o pedido inteiro (RN-04); a tela mostra o erro e nada muda                           |
| Status pedido igual ao atual em parte dos chamados                   | Esses contam como sucesso sem alteração (RN-09)                                                                    |
| `open → resolved` permitido, mas `resolved → pending` não            | Os que estavam resolvidos falham com `INVALID_TRANSITION`                                                          |
| Chamado alterado vira "fora do filtro" (ex.: fila "Sem responsável") | Some da lista ao recarregar e sai da seleção (RN-16, RN-21)                                                        |
| Solicitante chama a rota direto                                      | 403                                                                                                                |
| Pedido com `applyCompanyToRequester`                                 | 422 `VALIDATION_ERROR` (RN-03)                                                                                     |
| Erro inesperado (não `ApiException`) num chamado                     | Esse volta como `INTERNAL_ERROR` com mensagem genérica, os outros seguem, e o erro vai ao log sem dados do chamado |

## 9. Casos de teste

Fixture de tickets da spec T08–T10 §9 (U1, U2, G1, G2, C1, C2, `req1`, `ag1` em G1, `ag2` em G2, `sup`, `adm`), mais um grupo inativo G3 e chamados T1–T3 de `req1` em G1 e T4 de `req2` em G2. Os testes de notificação conferem as linhas da outbox.

| CT    | Dado                                                                                                                                                                       | Quando                                                                                                                                       | Então                                                                                                                                                                                                            | Cobre               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CT-01 | —                                                                                                                                                                          | `PATCH /tickets/bulk` como anônimo, solicitante, pendente, agente, supervisor e admin                                                        | 401, 403, bloqueio T22, 200, 200, 200 (linhas na matriz de permissões)                                                                                                                                           | RN-01               |
| CT-02 | ag1                                                                                                                                                                        | Pedido com 0 chamados, com 101, com `id` repetido, com `id` inválido                                                                         | 422 `VALIDATION_ERROR` nos quatro; nenhum chamado muda                                                                                                                                                           | RN-02               |
| CT-03 | ag1                                                                                                                                                                        | `changes` vazio; com `{priority, status}`; com `{groupId, assigneeId}`; com `applyCompanyToRequester`; com campo desconhecido                | 422 `VALIDATION_ERROR` nos cinco; nenhum chamado muda                                                                                                                                                            | RN-03               |
| CT-04 | ag1; G3 inativo                                                                                                                                                            | `changes: {groupId: G3}` para 3 chamados                                                                                                     | 422 `INACTIVE_REFERENCE`; nenhum chamado muda, nenhum evento                                                                                                                                                     | RN-04               |
| CT-05 | ag1; T1, T2, T3 abertos em G1 com unidade                                                                                                                                  | `changes: {priority: high}`                                                                                                                  | 200; os três com `priority = high`, `version + 1` e um `priority_changed` cada; `succeeded = 3`                                                                                                                  | RN-05, RN-10, RN-13 |
| CT-06 | ag1; T1 com unidade, T2 sem unidade, T3 fechado                                                                                                                            | `changes: {status: closed}`                                                                                                                  | T1 fechado; T2 `COMPANY_REQUIRED` com `number`; T3 `TICKET_CLOSED`; T2 e T3 sem evento nem `version` novo                                                                                                        | RN-05, RN-06, RN-14 |
| CT-07 | ag1; T1 `version = 2`                                                                                                                                                      | Pedido com T1 `version: 1` e T2 em dia                                                                                                       | T1 `VERSION_CONFLICT`, sem alteração; T2 alterado                                                                                                                                                                | RN-07               |
| CT-08 | ag1 (G1); T4 em G2, sem relação com ag1                                                                                                                                    | Pedido com T1 e T4                                                                                                                           | T1 alterado; T4 `NOT_FOUND` **sem** `number`; T4 não muda                                                                                                                                                        | RN-08, RN-14        |
| CT-09 | ag1; T1 já `high`, T2 `medium`                                                                                                                                             | `changes: {priority: high}`                                                                                                                  | T1 `ok`, `changed: false`, mesmo `version`, sem evento; T2 `changed: true`                                                                                                                                       | RN-09               |
| CT-10 | ag1; T1, T2 com unidade                                                                                                                                                    | `changes: {status: resolved}`                                                                                                                | Duas linhas `resolved` na outbox, uma por chamado; `resolved_at` preenchido nos dois                                                                                                                             | RN-11               |
| CT-11 | ag1; T1, T2                                                                                                                                                                | `changes: {status: closed}`                                                                                                                  | Nenhuma linha nova na outbox                                                                                                                                                                                     | RN-11               |
| CT-12 | sup; T1 em G1, T4 em G2                                                                                                                                                    | `changes: {groupId: G2}`; depois `changes: {assigneeId: ag2}` com os `version` novos                                                         | Primeiro os dois em G2 com `group_changed`; depois os dois com ag2, evento `assigned` e evento de domínio `ticket.assigned` em cada                                                                              | RN-03, RN-05        |
| CT-13 | ag1; T1 em G1                                                                                                                                                              | `changes: {assigneeId: ag2}` (ag2 não é de G1)                                                                                               | T1 falha `ASSIGNEE_NOT_IN_GROUP`                                                                                                                                                                                 | RN-05               |
| CT-14 | ag1; T1 sem unidade                                                                                                                                                        | `changes: {companyId: U1}`                                                                                                                   | T1 com U1 e evento `company_changed`; a unidade do solicitante **não** muda                                                                                                                                      | RN-03, RN-05        |
| CT-15 | ag1; 3 chamados; o 2º falha                                                                                                                                                | Pedido com os três                                                                                                                           | `results` na ordem do pedido; `succeeded = 2`, `failed = 1`                                                                                                                                                      | RN-06, RN-13        |
| CT-16 | Logger espionado                                                                                                                                                           | Pedido com sucesso e falha                                                                                                                   | Um log com ator, total, nomes dos campos e contagens; nenhum assunto, corpo ou e-mail                                                                                                                            | RN-12               |
| CT-17 | ag1                                                                                                                                                                        | `GET /tickets`                                                                                                                               | Cada item traz `version` igual ao do banco                                                                                                                                                                       | §5                  |
| CT-18 | ag1                                                                                                                                                                        | `PATCH /tickets/:id` depois da rota nova                                                                                                     | Continua funcionando; `PATCH /tickets/bulk` não é tratado como `:id`                                                                                                                                             | §5                  |
| CT-19 | Schema (unitário, shared)                                                                                                                                                  | 1 e 100 chamados; 101; repetido; `changes` vazio; `changes` com dois campos; `assigneeId: null`                                              | Aceita 1, 100 e `null`; recusa os outros                                                                                                                                                                         | RN-02, RN-03        |
| CT-20 | Tela (web), fila com 3 chamados                                                                                                                                            | Marca dois; depois a caixa do cabeçalho; depois troca de página                                                                              | Barra com "2 selecionados"; cabeçalho indeterminado e depois todos; ao trocar de página, seleção vazia e barra some                                                                                              | RN-15, RN-16, RN-17 |
| CT-21 | Tela (web), dois marcados                                                                                                                                                  | Alterar… → escolhe Prioridade → Alta → troca para Situação → Fechado → Aplicar → confirma                                                    | Aplicar desabilitado até ter opção e valor; ao trocar de opção, a prioridade escolhida é descartada; confirmação "Alterar a situação de 2 chamados para Fechado?"; o pedido leva os `id`/`version` e só `status` | RN-18, RN-20        |
| CT-22 | Tela (web), marcados só de G1; depois de G1 e G2                                                                                                                           | Abre Responsável                                                                                                                             | Primeiro "Ninguém", "Eu" e os membros de G1; depois só "Ninguém" e "Eu"                                                                                                                                          | RN-19               |
| CT-23 | Tela (web), três marcados; API devolve 1 sucesso (#1042) e 2 falhas (#1050 `VERSION_CONFLICT`, outro `NOT_FOUND`); na lista recarregada, o do `NOT_FOUND` não aparece mais | Aplicar                                                                                                                                      | "1 alterado"; lista com "#1050 — alterado por outra pessoa…" e "não encontrado ou fora do seu acesso"; #1042 e #1050 continuam marcados, barra com "2 selecionados"                                              | RN-21, RN-22        |
| CT-24 | Tela (web), solicitante em "Meus chamados"                                                                                                                                 | Abre a lista                                                                                                                                 | Sem caixas de seleção nem barra de ações                                                                                                                                                                         | RN-01               |
| CT-25 | Tela (web), dois marcados de G1                                                                                                                                            | Alterar… → Grupo G2 → aplica (API devolve `version` novos e a lista recarregada os mostra em G2); depois Alterar… → Responsável ag2 → aplica | O segundo pedido sai sem remarcar nada, com os mesmos dois `id` e os `version` da lista recarregada; as opções de Responsável já são os membros de G2                                                            | RN-16, RN-19, RN-21 |

## 10. Decisões tomadas na implementação

Preenchido depois da sessão.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T35-acoes-em-lote.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Pendências antes da sessão

Decididas pelo dono do produto em 19/11/2026 (#55): um campo por operação; até 100 chamados por pedido; `version` por chamado, com falha individual em conflito; unidade em lote só no chamado; "selecionar todos" só na página atual.

Seguem a recomendação do discovery, salvo aviso em contrário:

1. **Uma transação por chamado** (RN-05, RN-06), não uma para o lote: um chamado com problema não trava os outros, e o resultado parcial é o que a tela mostra.
2. **Referências conferidas uma vez** (RN-04): grupo, categoria ou unidade inválidos derrubam o pedido inteiro, em vez de 100 falhas iguais.
3. **Histórico igual ao individual** (RN-10): sem marca de "em lote" no evento.
4. **Notificações iguais ao individual** (RN-11): resolver 30 chamados manda 30 e-mails `resolved`, um a cada solicitante.
5. **Responsável só com grupo comum** (RN-19), para não oferecer quem a API vai recusar.
6. **Rota `PATCH /tickets/bulk`** na mesma controller, declarada antes de `:id` (CT-18).
7. **A seleção continua depois de aplicar** (RN-21), com os `version` novos, para encadear operações sem remarcar. A confirmação de cada operação (RN-20) evita aplicar a segunda sem querer.
