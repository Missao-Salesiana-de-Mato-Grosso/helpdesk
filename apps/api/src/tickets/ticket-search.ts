import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
} from '@helpdesk/shared';
import type { Prisma } from '../generated/prisma/client.js';

const MAX_INT = 2_147_483_647;
const NUMBER = /^#?(\d+)$/;
const MIN_TERM = 2;

/**
 * RN-15 (issue #48): `#1001` ou `1001` sozinho → só o número. Senão (termo com 2+ caracteres),
 * cada palavra precisa casar com alguma coluna da lista (assunto, nomes e e-mails do solicitante e
 * do responsável, unidade, grupo, categoria, número, situação ou prioridade); as palavras se
 * somam (AND), então "Unidade 2" acha só a Unidade 2. Termo menor é ignorado.
 */
export function searchFilter(q: string | undefined): Prisma.TicketWhereInput | null {
  const term = q?.trim() ?? '';
  const number = NUMBER.exec(term);
  if (number) return { number: toTicketNumber(number[1]!) ?? { in: [] } };

  if (term.length < MIN_TERM) return null;
  const words = [...new Set(term.split(/\s+/))];
  return { AND: words.map(wordFilter) };
}

function wordFilter(word: string): Prisma.TicketWhereInput {
  const text = { contains: word, mode: 'insensitive' } as const;
  const person = { OR: [{ name: text }, { email: text }] };
  const anyOf: Prisma.TicketWhereInput[] = [
    { subject: text },
    { requester: person },
    { assignee: { is: person } },
    { company: { is: { name: text } } },
    { group: { name: text } },
    { category: { name: text } },
  ];

  const number = NUMBER.exec(word);
  const value = number ? toTicketNumber(number[1]!) : null;
  if (value !== null) anyOf.push({ number: value });

  const statuses = TICKET_STATUSES.filter((s) => labelMatches(TICKET_STATUS_LABELS[s], word));
  if (statuses.length > 0) anyOf.push({ status: { in: statuses } });
  const priorities = TICKET_PRIORITIES.filter((p) => labelMatches(TICKET_PRIORITY_LABELS[p], word));
  if (priorities.length > 0) anyOf.push({ priority: { in: priorities } });

  return { OR: anyOf };
}

function toTicketNumber(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value <= MAX_INT ? value : null;
}

/** Rótulo começa com a palavra, sem diferenciar maiúsculas nem acentos ("media" → "Média"). */
function labelMatches(label: string, word: string): boolean {
  return fold(label).startsWith(fold(word));
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
