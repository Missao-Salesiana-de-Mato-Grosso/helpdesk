# Spec T38 — Busca no texto dos chamados (full-text)

> Status: implementada (20/11/2026) · Tarefas: T38 (#66) · Depende de: T08 (listagem e RN-15), #48 (pesquisa atual), T13 (anexos), T21 (texto citado) · Revisada em: 20/11/2026

## 1. Objetivo

O campo de busca da fila e de "Meus tickets" passa a achar chamados também pelo **texto da conversa**: mensagens públicas, notas internas (só para agentes), o texto citado dos e-mails e os nomes dos anexos. A busca ignora acentos e maiúsculas e entende variações da mesma palavra ("impressora" acha "impressoras"). O resultado mostra, abaixo do assunto, o trecho onde as palavras apareceram, destacadas.

## 2. Fora de escopo

- Motor de busca externo (Elasticsearch, Meilisearch etc.): a busca usa o full-text nativo do Postgres (ADR-002; CLAUDE.md).
- Buscar dentro do conteúdo dos anexos (PDF, imagem): só o nome do arquivo.
- Ordenar por relevância: a lista mantém a ordenação escolhida na tela (RN-09).
- Mudar a busca por campos da #48 (assunto, nomes, unidade…), que continua como está, inclusive sensível a acento. Unificar as duas fica para depois, se fizer falta.
- Busca na base de conhecimento (#69) e nos relatórios.

## 3. Fatos externos que esta spec assume

| Fato                                                                                                                                    | Fonte                       | Confirmar? |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------- |
| O Postgres traz o dicionário `portuguese` (stemming) sem extensão; `to_tsvector('portuguese', …)` é imutável                            | 📘 docs do PostgreSQL       | —          |
| A extensão `unaccent` **não** está instalada e criar extensão no DBaaS da Magalu não foi testado                                        | 📘 migrações (só `citext`)  | —          |
| Coluna gerada pode usar função SQL própria marcada `IMMUTABLE`                                                                          | 📘 docs do PostgreSQL       | —          |
| `body_html` e `quoted_html` já chegam sanitizados (allowlist), com acentos em UTF-8 e só `&amp; &lt; &gt; &quot; &nbsp;` como entidades | 📘 `sanitize-html`, T10/T21 | —          |
| Volume: ~500 chamados e ~3 mil mensagens por mês                                                                                        | 💡 01-escopo                | —          |

## 4. Regras de negócio

**Onde procura**

- **RN-01** — Além dos campos da #48, a busca procura no texto das **mensagens públicas**, das **notas internas**, no **texto citado** dos e-mails (`quoted_html`) e nos **nomes dos anexos** (decisão 1).
- **RN-02** — Visibilidade: o solicitante só acha pelo texto e pelos anexos das mensagens **públicas** dos próprios chamados; o agente acha também pelas notas internas e pelos anexos delas, sempre dentro do escopo dele (RN-01 da T08). Nota interna **nunca** faz um chamado aparecer, nem gera trecho, para quem não é agente. O filtro é aplicado na consulta, não depois.

**Como casa**

- **RN-03** — Um chamado aparece se casar com a busca **por campos** (RN-15 da T08, como hoje) **ou** com a busca **no texto** (decisão 2): um campo só, sem opção nova.
- **RN-04** — Busca no texto: todas as palavras precisam aparecer na **mesma mensagem** (AND), sem diferenciar acentos nem maiúsculas, com stemming do português ("impressoras" acha "impressora"; "configuração" acha "configurar" quando o radical bate). Também valem `"frase entre aspas"` e `-palavra` para excluir (sintaxe `websearch_to_tsquery`).
- **RN-05** — Anexos: o chamado casa se **cada** palavra aparecer no nome de algum anexo visível do chamado (sem diferenciar maiúsculas e acentos).
- **RN-06** — Termo só com número (`1042`, `#1042`) continua achando só pelo número (RN-15 da T08). Termo com menos de 2 caracteres continua ignorado.
- **RN-07** — Palavras que o dicionário descarta (de, a, o, para…) não impedem a busca; busca formada só por elas não acha nada pelo texto (os campos continuam valendo).

**Resultado**

- **RN-08** — Cada chamado achado pelo texto traz um **trecho** de até ~30 palavras da mensagem que casou, com as palavras encontradas destacadas, mostrado abaixo do assunto na lista. Se casou por mais de uma mensagem, vale a mais recente. Se casou só pelo nome de anexo, o trecho é "Anexo: <nome>". Chamado achado só pelos campos não tem trecho.
- **RN-09** — A ordenação, a paginação e os contadores não mudam: a busca só filtra.
- **RN-10** — O trecho é texto puro: o destaque é feito pela tela, sem inserir HTML vindo da mensagem (nada de `innerHTML`).
- **RN-11** — O trecho de nota interna só sai para agentes (RN-02) e é marcado como "Nota interna".

## 5. Contrato da API

**`GET /api/tickets?q=…`** (já existe): mesmo contrato, com um campo novo opcional em cada item da lista:

```ts
interface TicketMatch {
  /** Trecho em texto puro; as partes encontradas vêm entre os marcadores U+E000 e U+E001. */
  snippet: string;
  /** De onde veio: mensagem pública, nota interna ou nome de anexo. */
  source: 'public' | 'internal' | 'attachment';
}
interface TicketSummary {
  /* … */ match?: TicketMatch;
}
```

`match` só aparece quando há `q` e o chamado casou pelo texto ou por anexo. Os marcadores são caracteres de uso privado do Unicode, que não aparecem em texto digitado; a tela os troca por `<mark>`.

## 6. Dados

Migração `ticket_message_search`, sem extensão nova:

```sql
-- Texto pesquisável: sem tags, entidades comuns decodificadas, minúsculo e sem acento.
CREATE FUNCTION helpdesk_search_text(html text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT translate(lower(
    replace(replace(replace(replace(replace(
      regexp_replace(html, '<[^>]*>', ' ', 'g'),
      '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&amp;', '&')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;

ALTER TABLE ticket_messages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', coalesce(helpdesk_search_text(body_html), '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(helpdesk_search_text(quoted_html), '')), 'D')
  ) STORED;

CREATE INDEX ticket_messages_search_vector_idx ON ticket_messages USING GIN (search_vector);
```

- A coluna é **gerada**: as mensagens que já existem são indexadas na própria migração, e nenhum caminho de gravação (portal, e-mail, importação) precisa lembrar de preenchê-la.
- No Prisma, a coluna fica como `Unsupported("tsvector")?`; a consulta usa `$queryRaw` tipado (ADR-002).
- A busca aplica a mesma normalização no termo: `websearch_to_tsquery('portuguese', helpdesk_search_text(<termo>))`.
- Nomes de anexo: `helpdesk_search_text(filename) LIKE '%' || <palavra normalizada> || '%'`, sem índice novo (poucos anexos por chamado, filtrados pelo chamado).

## 7. Configuração

Nenhuma variável nova. Nenhuma dependência nova.

## 8. Casos de borda

| Caso                                                               | Comportamento                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Palavra só no texto citado de vários e-mails do mesmo chamado      | O chamado aparece uma vez; o trecho vem da mensagem mais recente que casou         |
| Termo com aspas sem fechar ou só `-palavra`                        | `websearch_to_tsquery` não dá erro; busca só por exclusão não acha nada pelo texto |
| Termo com caracteres especiais (`%`, `_`, `\`)                     | Escapados no `LIKE` dos anexos; no full-text o parser os ignora                    |
| Solicitante busca uma palavra que só existe numa nota interna      | Nada (RN-02)                                                                       |
| Agente de outro grupo busca palavra de chamado fora do escopo dele | Nada (escopo da T08 aplicado na mesma consulta)                                    |
| Mensagem só com imagem                                             | Sem texto: não casa pelo texto                                                     |
| Busca muito comum (ex.: "obrigado") casando milhares de mensagens  | A consulta devolve só os ids dos chamados; a página continua com 25 itens          |

## 9. Casos de teste

| CT    | Dado                                                                                              | Quando                                                | Então                                                                                                                                   | Cobre               |
| ----- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| CT-01 | `helpdesk_search_text('<p>Configuração da <b>Impressora</b> &amp; rede</p>')`                     | SQL                                                   | `configuracao da impressora & rede` (com espaços das tags)                                                                              | §6                  |
| CT-02 | mensagem pública "As impressoras da secretaria não imprimem"                                      | agente busca `impressora secretaria`                  | Chamado na lista com `match.source = 'public'` e o trecho com as duas palavras marcadas                                                 | RN-01, RN-04        |
| CT-03 | idem                                                                                              | busca `IMPRESSÃO`, `impressão` e `impressao`          | Os três acham (sem acento, sem maiúscula); `impressora rede` (palavra ausente) não acha                                                 | RN-04               |
| CT-04 | nota interna "senha do roteador trocada"                                                          | agente busca `roteador`; solicitante busca `roteador` | Agente acha, com `source = 'internal'`; solicitante não acha nem recebe trecho                                                          | RN-02, RN-11        |
| CT-05 | e-mail com o texto só no `quoted_html`                                                            | agente busca a palavra                                | Acha                                                                                                                                    | RN-01               |
| CT-06 | anexo `Boleto_Janeiro.pdf` numa mensagem pública; outro `planilha-secreta.xlsx` numa nota interna | solicitante busca `boleto`; e `planilha`              | `boleto` acha com trecho "Anexo: Boleto_Janeiro.pdf"; `planilha` não acha para o solicitante                                            | RN-02, RN-05, RN-08 |
| CT-07 | chamado fora do escopo do agente `ag2` com a palavra                                              | `ag2` busca                                           | Não aparece                                                                                                                             | RN-02               |
| CT-08 | chamado com a palavra no assunto e outro com a palavra só no texto                                | busca                                                 | Os dois aparecem; só o segundo tem `match`                                                                                              | RN-03, RN-08        |
| CT-09 | `q = 1042`                                                                                        | busca                                                 | Só o chamado #1042, mesmo que "1042" esteja no texto de outro                                                                           | RN-06               |
| CT-10 | duas mensagens que casam no mesmo chamado                                                         | busca                                                 | O trecho vem da mais recente                                                                                                            | RN-08               |
| CT-11 | `"rede caiu"` e `rede -wifi`                                                                      | busca                                                 | Frase exata e exclusão funcionam                                                                                                        | RN-04               |
| CT-12 | termo `%_\`                                                                                       | busca                                                 | 200, sem erro de SQL                                                                                                                    | §8                  |
| CT-13 | `splitSnippet` (web)                                                                              | trecho com marcadores                                 | Partes alternadas texto/destaque; texto sem marcador vira uma parte só                                                                  | RN-10               |
| CT-14 | fila com item com `match`                                                                         | renderiza                                             | Trecho abaixo do assunto, palavras em `<mark>`, "Nota interna" quando `source = 'internal'`; um `<script>` no trecho aparece como texto | RN-08, RN-10, RN-11 |
| CT-15 | "Meus tickets" com item com `match`                                                               | renderiza                                             | Trecho abaixo do assunto                                                                                                                | RN-08               |

## 10. Decisões tomadas na implementação

- **Duas funções SQL em vez de uma (§6):** `helpdesk_plain_text` tira as tags e decodifica as entidades (mantém maiúsculas e acentos), e `helpdesk_fold` troca cada letra acentuada por uma letra sem acento, **com o mesmo número de caracteres**. O índice usa `to_tsvector('portuguese', helpdesk_fold(helpdesk_plain_text(…)))` (o dicionário já ignora maiúsculas). Com uma função só, que também passava para minúsculas, o trecho do resultado sairia sem acento e em minúsculas.
- **Trecho com acentos (RN-08):** o `ts_headline` marca o trecho sobre o texto sem acento; a API acha esse pedaço no texto original nas mesmas posições (`restoreAccents` em `ticket-search.ts`) e copia as letras originais, mantendo os marcadores. Se não achar, devolve o trecho sem acento. A contagem é por código Unicode nos dois lados (`Array.from` no JS, caracteres no Postgres).
- **Marcadores:** `TICKET_MATCH_START`/`TICKET_MATCH_END` (U+E000/U+E001) em `packages/shared`, usados pela API e pela tela.
- **Anexos:** imagens coladas no texto (T32, `inline`) ficam fora da busca por nome (nomes genéricos como `image.png`). Para o trecho "Anexo: <nome>", basta o nome ter **uma** das palavras: o chamado já casou pela regra da RN-05.
- **Integração com a listagem:** a busca no texto devolve os ids dos chamados (`TicketsRepository.findTextMatches`), que entram como `OR` no filtro por campos da #48; escopo, visão, filtros, ordenação e paginação continuam os de sempre. Os trechos são buscados só para os chamados da página (`findTextSnippets`).
- **Prisma:** a coluna fica no schema como `Unsupported("tsvector")?` com o índice GIN, para o schema bater com a migração; a coluna gerada é escrita só no SQL da migração.
- **Testes:** CT-01 a CT-12 em `test/text-search.e2e-spec.ts` (rodam só no CI); auxiliares (`textSearchTerm`, `attachmentWords`, `escapeLike`, `foldText`, `restoreAccents`) em `ticket-search.spec.ts`; CT-13 a CT-15 em `features/tickets/match-snippet.test.tsx`.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/T38-busca-full-text.md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```

## 12. Decisões

1. **Procura em** mensagens públicas, notas internas, texto citado e nomes de anexos (20/11/2026).
2. **Mesmo campo de busca**, sem opção nova (20/11/2026).
3. **Trecho destacado** no resultado (20/11/2026).
4. **Solicitante também busca** no texto dos próprios chamados, só nas mensagens públicas (20/11/2026).
5. 💡 Sem extensão nova (`unaccent`): a remoção de acento é feita por uma função SQL própria, porque criar extensão no DBaaS da Magalu não foi testado e uma migração que falha trava o deploy.
6. 💡 Sem ordenação por relevância (RN-09): a fila já tem ordenações que os agentes usam; relevância pode vir depois.
7. 💡 Todas as palavras na mesma mensagem (RN-04), e não espalhadas pelo chamado: dá resultados mais precisos e cabe num índice só.
