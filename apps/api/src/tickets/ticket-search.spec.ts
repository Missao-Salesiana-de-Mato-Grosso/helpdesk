import type { Prisma } from '../generated/prisma/client.js';
import { searchFilter } from './ticket-search.js';

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
