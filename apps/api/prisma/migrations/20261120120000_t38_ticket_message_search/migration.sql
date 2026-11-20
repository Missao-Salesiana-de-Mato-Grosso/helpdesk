-- T38: busca no texto das mensagens (full-text nativo, sem extensão nova).

-- Texto da mensagem sem tags, com as entidades que o sanitize-html gera decodificadas. Mantém
-- maiúsculas e acentos (o trecho do resultado sai daqui).
CREATE FUNCTION helpdesk_plain_text(html text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT replace(replace(replace(replace(replace(replace(
    regexp_replace(html, '<[^>]*>', ' ', 'g'),
    '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&')
$$;

-- Troca cada letra acentuada por uma letra sem acento: o texto mantém o mesmo tamanho, então as
-- posições do trecho encontrado valem também no texto original (a API devolve os acentos).
CREATE FUNCTION helpdesk_fold(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT translate(value,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')
$$;

-- Corpo com peso A e texto citado com peso D. Coluna gerada: as mensagens existentes são
-- indexadas aqui mesmo, e nenhum caminho de gravação precisa preenchê-la.
ALTER TABLE "ticket_messages" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', coalesce(helpdesk_fold(helpdesk_plain_text("body_html")), '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(helpdesk_fold(helpdesk_plain_text("quoted_html")), '')), 'D')
  ) STORED;

CREATE INDEX "ticket_messages_search_vector_idx" ON "ticket_messages" USING GIN ("search_vector");
