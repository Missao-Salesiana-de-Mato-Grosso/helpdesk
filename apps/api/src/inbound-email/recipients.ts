import type { AddressObject, ParsedMail } from 'mailparser';
import { headerTexts } from './loop-guard.js';

const ADDRESS = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g;

/** Cabeçalhos que o encaminhamento do Gmail (e outros servidores) grava com o destino original. */
const FORWARD_HEADERS = ['x-forwarded-for', 'x-original-to', 'delivered-to'];

const addressesOf = (value: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((object) =>
    object.value.flatMap((entry) => (entry.address ? [entry.address] : [])),
  );

/**
 * Para quem o e-mail foi enviado, em minúsculas e sem repetição: primeiro `To` e `Cc` (o que o
 * remetente escreveu), depois os cabeçalhos de encaminhamento (`cadastros@` → `suporte@`).
 */
export function recipientAddresses(parsed: Pick<ParsedMail, 'to' | 'cc' | 'headers'>): string[] {
  const fromHeaders = FORWARD_HEADERS.flatMap((key) =>
    headerTexts(parsed.headers, key).flatMap((value) => value.match(ADDRESS) ?? []),
  );
  const all = [...addressesOf(parsed.to), ...addressesOf(parsed.cc), ...fromHeaders];
  return [...new Set(all.map((address) => address.trim().toLowerCase()))];
}
