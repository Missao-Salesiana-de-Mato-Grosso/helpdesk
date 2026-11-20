# Spec T37 — Relatórios de atendimento

> Status: implementada (20/11/2026) · Tarefas: T37 (#64) · Depende de: T08–T10 (timestamps do ticket), T28 (SLA e horário útil) · Revisada em: 20/11/2026

## 1. Objetivo

Supervisor e admin ganham a tela **Relatórios**: para um período escolhido, quantos chamados entraram e saíram, quanto tempo a equipe levou para responder e resolver (em horário útil), quanto do SLA foi cumprido, e como isso se divide por grupo, agente, unidade, categoria, canal e prioridade. Os números aparecem em cartões, num gráfico de evolução e em tabelas exportáveis para CSV.

## 2. Fora de escopo

- Relatório para agentes (decisão 1): eles continuam só com os contadores da fila.
- Relatórios agendados por e-mail, painéis personalizáveis e comparação entre dois períodos.
- CSAT (Fase 2, item próprio) e trilha de auditoria.
- Histórico de quem era o responsável ou o grupo **na época**: as quebras usam o grupo e o responsável **atuais** do chamado (RN-09).
- Tempo por agente "trabalhando" (tempo de tela, tempo entre respostas).

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                | Fonte                      | Confirmar? |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------- |
| `first_response_at`, `resolved_at` e `closed_at` são gravados desde o MVP; reabrir um resolvido limpa `resolved_at` | 📘 03-arquitetura, T09     | —          |
| Os prazos do SLA (`*_due_at`) já incluem o tempo pausado; nulos quando não há meta para a prioridade                | 📘 T28                     | —          |
| `slaPausedMinutes` soma os minutos úteis em pendente/resolvido antes da retomada; resolvido → fechado não mexe nele | 📘 T28 (`SlaService.plan`) | —          |
| ~500 chamados/mês: um ano inteiro são ~6 mil linhas, que cabem em memória para calcular em Node                     | 💡 01-escopo               | —          |
| `@mantine/charts` acompanha a versão do `@mantine/core` (9.7.3) e pede `recharts` ≥ 3.2.1 como peer                 | 📘 npm                     | —          |

## 4. Regras de negócio

**Acesso e filtros**

- **RN-01** — Só `supervisor` e `admin`. A tela fica no menu como "Relatórios", em `/relatorios`; agente e solicitante recebem 403 na API e não veem o item de menu.
- **RN-02** — Filtros: **período** (de/até, datas no fuso `BUSINESS_TIMEZONE`, inclusive nas duas pontas) e **grupo** (opcional, um só). Atalhos: últimos 7 dias, últimos 30 dias (padrão), mês atual, mês anterior. Período de no máximo **366 dias**; "até" antes de "de" ou fora do limite → `422 VALIDATION_ERROR`.
- **RN-03** — O filtro de grupo usa o grupo **atual** do chamado (RN-09).

**Volume**

- **RN-04** — **Criados**: `created_at` no período. **Resolvidos**: `resolved_at` no período. **Fechados**: `closed_at` no período. **Em aberto agora**: `open` + `pending` no momento da consulta, independentemente do período (respeita o filtro de grupo).
- **RN-05** — Chamado fechado direto, sem passar por resolvido, conta em "fechados" mas não em "resolvidos" nem no tempo de resolução.

**Tempos (horário útil)**

- **RN-06** — Tempo até a **1ª resposta**: minutos úteis entre `created_at` e `first_response_at`, para os chamados com `first_response_at` no período. Usa o calendário do SLA (horário comercial e feriados da T28).
- **RN-07** — Tempo até a **resolução**: minutos úteis entre `created_at` e `resolved_at`, **menos** `sla_paused_minutes` (o tempo em pendente), para os chamados com `resolved_at` no período. Resultado negativo vira 0.
- **RN-08** — Cada tempo mostra **mediana** e **média**, com o número de chamados que entraram no cálculo. Sem chamado, mostra "—". Na tela, formato `Xd Yh`, `Xh Ymin` ou `Ymin` (dia útil = os minutos úteis do calendário são mostrados em horas; "d" só a partir de 24h).

**SLA**

- **RN-09** — **1ª resposta cumprida**: dos chamados com meta (`first_response_due_at` não nulo), conta como avaliado no período quem (a) teve `first_response_at` no período — cumprido se `first_response_at ≤ first_response_due_at` —, ou (b) continua sem resposta e teve o prazo vencido dentro do período (`first_response_due_at` no período e antes de agora) — descumprido.
- **RN-10** — **Resolução cumprida**: mesma regra com `resolved_at` e `resolution_due_at`; chamado ainda aberto ou pendente com prazo vencido no período conta como descumprido.
- **RN-11** — O percentual é `cumpridos / avaliados`, com os dois números ao lado. Sem avaliado, "—".

**Quebras**

- **RN-12** — Tabelas por **grupo**, **agente** (responsável atual; linha "Sem responsável"), **unidade** (linha "Sem unidade") e **categoria**, cada uma com: criados, resolvidos, mediana da 1ª resposta, mediana da resolução, % de 1ª resposta cumprida e % de resolução cumprida. Cada linha usa as mesmas regras de RN-04 a RN-11, só restritas aos chamados da linha. Ordenadas por criados, decrescente; empate pelo nome.
- **RN-13** — Distribuição dos **criados** por **canal** (portal, e-mail, aberto por agente) e por **prioridade** (baixa, média, alta, urgente), com quantidade e percentual.
- **RN-14** — Agentes, grupos, unidades e categorias inativos aparecem normalmente se tiverem chamados no período (o nome traz "(inativo)").

**Evolução**

- **RN-15** — Gráfico de linhas com **criados** e **resolvidos** por dia. Com período acima de 62 dias, os pontos são por semana (segunda a domingo, rótulo = a segunda-feira).

**Exportação**

- **RN-16** — Cada tabela de quebra tem "Baixar CSV": separador `;`, BOM UTF-8 (abre direto no Excel em pt-BR), cabeçalho em pt-BR, tempos em minutos úteis (número inteiro) e percentuais com vírgula decimal. Nome do arquivo `relatorio-<quebra>-<de>-a-<até>.csv`. Gerado no navegador a partir da resposta já carregada (sem rota nova).

**Dados e privacidade**

- **RN-17** — O relatório só mostra números agregados e nomes de agentes, grupos, unidades e categorias: nenhum assunto, solicitante ou conteúdo de chamado.
- **RN-18** — Chamados importados do Freshdesk (T29) entram como os outros, com as datas que trouxeram.

## 5. Contrato da API

### `GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&groupId=<uuid>`

Papéis: `supervisor`, `admin`. `groupId` opcional; inexistente → resposta vazia (não 404). Validação por schema zod em `packages/shared` (`reportQuerySchema`).

```ts
interface ReportDuration {
  median: number | null;
  average: number | null;
  count: number;
} // minutos úteis
interface ReportRate {
  met: number;
  evaluated: number;
} // % = met/evaluated
interface ReportMetrics {
  created: number;
  resolved: number;
  closed: number;
  firstResponse: ReportDuration;
  resolution: ReportDuration;
  firstResponseSla: ReportRate;
  resolutionSla: ReportRate;
}
interface ReportRow extends ReportMetrics {
  id: string | null;
  name: string;
  active: boolean;
}
interface ReportSummary {
  from: string;
  to: string;
  groupId: string | null;
  bucket: 'day' | 'week';
  totals: ReportMetrics & { openNow: number };
  series: { date: string; created: number; resolved: number }[];
  byGroup: ReportRow[];
  byAgent: ReportRow[];
  byCompany: ReportRow[];
  byCategory: ReportRow[];
  bySource: { source: TicketSource; count: number }[];
  byPriority: { priority: TicketPriority; count: number }[];
}
```

Erros: `422 VALIDATION_ERROR` (datas inválidas, invertidas ou > 366 dias), `403 FORBIDDEN_ROLE`.

## 6. Dados

Nenhuma tabela nova nem migração. Módulo Nest novo `reports` (controller + service), que lê tickets por um repositório próprio e o calendário pelo `SlaService.context()`. A consulta busca, com `select` mínimo, os chamados com **qualquer** das datas (`created_at`, `first_response_at`, `resolved_at`, `closed_at`, `first_response_due_at`, `resolution_due_at`) no período, mais a contagem dos em aberto; o resto é calculado em memória. Os índices atuais bastam para o volume previsto.

## 7. Configuração

Nenhuma variável nova. Dependências novas no `apps/web`: `@mantine/charts@9.7.3` (mesma versão do core) e `recharts@^3` (aprovadas na decisão 3).

## 8. Casos de borda

| Caso                                                | Comportamento                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Período sem nenhum chamado                          | Zeros, "—" nos tempos e no SLA, gráfico com a linha em zero                  |
| Sem horário comercial cadastrado (calendário vazio) | Tempos "—" (não dá para medir horário útil); volume normal; SLA sem metas    |
| Chamado criado antes do período e resolvido dentro  | Entra em resolvidos e no tempo de resolução, não em criados                  |
| Chamado resolvido, reaberto e resolvido de novo     | Vale o último `resolved_at`; o pendente/resolvido intermediário é descontado |
| Prioridade sem meta de SLA                          | Fora do SLA (não avaliado), mas entra nos tempos                             |
| "Até" no futuro                                     | Aceito; os dias futuros aparecem zerados no gráfico                          |
| Responsável desativado                              | Linha com "(inativo)"                                                        |

## 9. Casos de teste

| CT    | Dado                                                                                                          | Quando                                                | Então                                                                                            | Cobre        |
| ----- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| CT-01 | —                                                                                                             | `reportQuerySchema`                                   | Aceita datas válidas e `groupId` opcional; recusa "até" < "de", > 366 dias e formato errado      | RN-02        |
| CT-02 | lista de durações `[30, 10, 20, 40]`                                                                          | `summarize` (função pura)                             | mediana 25, média 25, count 4; lista vazia → `null`s e 0                                         | RN-08        |
| CT-03 | chamado criado seg 08:00, 1ª resposta seg 10:00, resolvido ter 10:00, 60 min pausados; expediente 08–12/13–17 | `ticketDurations` (pura)                              | 1ª resposta 120 min; resolução 600 − 60 = 540 min                                                | RN-06, RN-07 |
| CT-04 | quatro chamados: respondido no prazo, respondido fora, sem resposta e vencido no período, sem meta            | `slaRates` (pura)                                     | 1ª resposta: met 1, evaluated 3                                                                  | RN-09, RN-11 |
| CT-05 | datas de 20 dias e de 90 dias                                                                                 | `buildSeries` (pura)                                  | 20 pontos diários; 90 dias → semanas começando na segunda                                        | RN-15        |
| CT-06 | `formatDuration` no web                                                                                       | 45, 125, 1500 minutos e `null`                        | `45min`, `2h 5min`, `1d 1h`, `—`                                                                 | RN-08        |
| CT-07 | fixture com chamados criados, resolvidos e fechados dentro e fora do período                                  | `GET /reports/summary` como `sup`                     | `created`, `resolved`, `closed` e `openNow` corretos; fechado direto não entra em resolvidos     | RN-04, RN-05 |
| CT-08 | chamados em G1 e G2                                                                                           | `groupId = G1`                                        | Só os de G1 em totais, série e quebras                                                           | RN-03        |
| CT-09 | chamados de ag1, ag2 e sem responsável; unidade nula em um                                                    | resumo                                                | `byAgent` com ag1, ag2 e "Sem responsável"; `byCompany` com "Sem unidade"; ordenados por criados | RN-12        |
| CT-10 | chamados por e-mail, portal e agente; prioridades variadas                                                    | resumo                                                | `bySource` e `byPriority` com as contagens dos criados                                           | RN-13        |
| CT-11 | `ag1`, `req1`                                                                                                 | `GET /reports/summary`                                | 403 (linha nova na matriz de permissões)                                                         | RN-01        |
| CT-12 | `sup`                                                                                                         | `from` > `to`; 400 dias                               | 422 VALIDATION_ERROR                                                                             | RN-02        |
| CT-13 | resposta com assuntos na base                                                                                 | resumo                                                | O JSON não contém assunto, e-mail nem nome de solicitante                                        | RN-17        |
| CT-14 | tela como supervisor                                                                                          | abre Relatórios                                       | Cartões (criados, resolvidos, em aberto, tempos, SLA), gráfico, tabelas; período padrão 30 dias  | RN-02, RN-12 |
| CT-15 | tela                                                                                                          | troca o atalho para "Mês anterior" e escolhe um grupo | Nova consulta com `from`/`to` do mês anterior e `groupId`                                        | RN-02        |
| CT-16 | tela                                                                                                          | "Baixar CSV" na tabela de agentes                     | Arquivo com BOM, `;`, cabeçalho pt-BR, minutos inteiros e percentual com vírgula                 | RN-16        |
| CT-17 | agente logado                                                                                                 | menu e `/relatorios`                                  | Sem item "Relatórios"; a rota mostra acesso negado                                               | RN-01        |

## 10. Decisões tomadas na implementação

- **Módulos:** o módulo `reports` não lê tabelas de outros módulos (regra do CLAUDE.md). Os chamados vêm de `TicketsService.reportData` (consulta em `TicketsRepository.findForReport`, só com as colunas do relatório), e os nomes vêm de `refsByIds` novos em `GroupsService`, `UsersService`, `CompaniesService` e `CategoriesService`.
- **Fuso:** os limites do período e o agrupamento por dia usam dois helpers novos em `sla/business-time.ts` (`startOfLocalDay` e `localDate`), no fuso `BUSINESS_TIMEZONE`.
- **"(inativo)" (RN-14):** a API devolve `active` em cada linha, e a tela e o CSV acrescentam "(inativo)" ao nome.
- **Linhas vazias:** uma quebra só lista quem tem algum número no período (criados, resolvidos, fechados, tempo ou SLA avaliado).
- **Validação de data:** o zod roda todas as checagens mesmo depois de uma falhar. Uma data inexistente (30/02) chegou a lançar exceção em vez de recusar, o que viraria 500; a checagem foi unificada, e o CT-12 cobre o caso.
- **Carregamento:** a tela é carregada sob demanda (`React.lazy`). Os gráficos (`recharts`) ficam num arquivo separado de ~430 kB, que só supervisor e admin baixam; o bundle principal continua do mesmo tamanho.
- **Versões:** `@mantine/charts` fixado em `9.7.3`, a mesma versão do core instalada (o peer pede igualdade exata); `recharts` em `~3.10.1`.
- **Testes:** CT-01 em `reports.test.ts` (shared); CT-02 a CT-05 em `report-math.spec.ts`; CT-07 a CT-13 em `test/reports.e2e-spec.ts` e na matriz de permissões (rodam só no CI); CT-06 e CT-14 a CT-17 em `features/reports/reports.test.tsx`.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T37-relatorios.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Decisões

1. **Só supervisor e admin** (20/11/2026).
2. **Números:** volume, tempos, SLA cumprido e distribuição por canal e prioridade (20/11/2026).
3. **Tabelas, gráficos e CSV**, com `@mantine/charts` + `recharts` como dependências novas (20/11/2026).
4. **Horário útil**, o mesmo calendário do SLA, descontando o pendente (20/11/2026).
5. 💡 Quebras pelo grupo e responsável **atuais** do chamado (RN-03, RN-12): o banco não guarda um retrato da época, e reconstruir pelos `ticket_events` fica para depois, se fizer falta.
6. 💡 Período padrão de 30 dias e limite de 366 (RN-02).
7. 💡 Na 1ª resposta não se desconta pausa (RN-06): o chamado raramente fica pendente antes da primeira resposta, e o prazo da T28 também conta a partir da abertura.
