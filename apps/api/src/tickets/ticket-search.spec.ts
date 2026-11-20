import type { Prisma } from '../generated/prisma/client.js';
import {
  attachmentWords,
  escapeLike,
  foldText,
  restoreAccents,
  searchFilter,
  textSearchTerm,
} from './ticket-search.js';

/** As cláusulas `OR` de cada palavra, na ordem do termo. */
function wordClauses(q: string): Prisma.TicketWhereInput[][] {
  const and = searchFilter(q)?.AND;
  if (!Array.isArray(and)) throw new Error(`esperava AND para "${q}"`);
  return and.map((word) => word.OR ?? []);
}

// Spec docs/specs/T08-T10-tickets-core.md, RN-15 (ampliada pela issue #48).
describe('searchFilter', () => {
  it('CT-16 número sozinho, com ou sem #, busca só pelo número', () => {
    expect(searchFilter('#1002')).toEqual({ number: 1002 });
    expect(searchFilter(' 1002 ')).toEqual({ number: 1002 });
    expect(searchFilter('99999999999')).toEqual({ number: { in: [] } });
  });

  it('CT-17 vazio ou de 1 caractere ignora o filtro', () => {
    expect(searchFilter(undefined)).toBeNull();
    expect(searchFilter('   ')).toBeNull();
    expect(searchFilter('a')).toBeNull();
  });

  it('CT-51 cada palavra vira um OR por todas as colunas, e as palavras se somam', () => {
    const words = wordClauses('impressora  maria impressora');
    expect(words).toHaveLength(2);
    const text = { contains: 'impressora', mode: 'insensitive' };
    const person = { OR: [{ name: text }, { email: text }] };
    expect(words[0]).toEqual([
      { subject: text },
      { requester: person },
      { assignee: { is: person } },
      { company: { is: { name: text } } },
      { group: { name: text } },
      { category: { name: text } },
    ]);
  });

  it('CT-52 palavra numérica no meio do texto também casa o número', () => {
    expect(wordClauses('impressora 1001')[1]).toContainEqual({ number: 1001 });
  });

  it('CT-53 casa situação e prioridade pelo rótulo, sem acento nem maiúsculas', () => {
    expect(wordClauses('pendente')[0]).toContainEqual({ status: { in: ['pending'] } });
    expect(wordClauses('MEDIA')[0]).toContainEqual({ priority: { in: ['medium'] } });
    expect(wordClauses('urg')[0]).toContainEqual({ priority: { in: ['urgent'] } });
    // Só o começo do rótulo: "ta" não é "Alta".
    expect(wordClauses('ta')[0]).not.toContainEqual({ priority: { in: ['high'] } });
  });
});

// Spec docs/specs/T38-busca-full-text.md.
describe('busca no texto — auxiliares (T38)', () => {
  const S = '\uE000';
  const E = '\uE001';

  it('RN-06 número sozinho e termo curto não vão para o texto', () => {
    expect(textSearchTerm('1042')).toBeNull();
    expect(textSearchTerm('#1042')).toBeNull();
    expect(textSearchTerm('a')).toBeNull();
    expect(textSearchTerm('  impressora  ')).toBe('impressora');
    expect(textSearchTerm('erro 1042')).toBe('erro 1042');
  });

  it('RN-05 palavras dos anexos: sem aspas, sem exclusões, sem repetir', () => {
    expect(attachmentWords('"boleto janeiro" -pdf boleto')).toEqual(['boleto', 'janeiro']);
  });

  it('CT-12 escapa os curingas do LIKE', () => {
    expect(escapeLike(String.raw`50%_a\b`)).toBe(String.raw`50\%\_a\\b`);
  });

  it('foldText troca uma letra por uma, como a função SQL', () => {
    const text = 'Configuração ÁGUA não';
    expect(foldText(text)).toBe('Configuracao AGUA nao');
    expect(foldText(text)).toHaveLength(text.length);
  });

  it('RN-08 devolve os acentos ao trecho, mantendo os marcadores', () => {
    const plain = 'Bom dia. A impressão da secretaria não sai desde ontem.';
    const headline = `A ${S}impressao${E} da secretaria nao sai`;
    expect(restoreAccents(headline, plain)).toBe(`A ${S}impressão${E} da secretaria não sai`);
  });

  it('sem achar o pedaço no original, devolve o trecho como veio', () => {
    expect(restoreAccents(`${S}rede${E} caiu`, 'outro texto')).toBe(`${S}rede${E} caiu`);
  });
});
