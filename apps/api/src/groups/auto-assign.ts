import type { NamedRef } from '@helpdesk/shared';

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

/** Ordem do rodízio (T36 RN-07): alfabética pelo nome, empate pelo id. */
export function compareAgents(a: NamedRef, b: NamedRef): number {
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * T36 RN-07 e RN-08: o próximo do rodízio entre os elegíveis do momento. É o primeiro que vem
 * depois de `last` na ordem alfabética (mesmo que `last` não seja mais elegível); depois do
 * último, volta ao primeiro. Sem `last`, o primeiro da lista. Sem elegíveis, `null`.
 */
export function nextAutoAssignee(
  eligible: readonly NamedRef[],
  last: NamedRef | null,
): NamedRef | null {
  const ordered = eligible.toSorted(compareAgents);
  if (ordered.length === 0) return null;
  if (!last) return ordered[0] ?? null;
  return ordered.find((agent) => compareAgents(agent, last) > 0) ?? ordered[0] ?? null;
}
