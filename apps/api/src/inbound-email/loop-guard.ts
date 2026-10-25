/** Motivos de descarte da RN-08, na ordem da RN-09 (os de cabeçalho; os de remetente vêm depois). */
export type DiscardReason =
  | 'auto_submitted'
  | 'bulk'
  | 'auto_reply'
  | 'own_address'
  | 'bounce'
  | 'dmarc_fail'
  | 'inactive_sender'
  | 'rate_limited';

/** Cabeçalhos como o `mailparser` entrega: chave em minúsculas; valor texto, objeto ou lista. */
export type ParsedHeaders = ReadonlyMap<string, unknown>;

/** Valor de um cabeçalho como texto (o 1º, se repetido; `value` dos estruturados). */
export function headerText(headers: ParsedHeaders, key: string): string | null {
  return headerTexts(headers, key)[0] ?? null;
}

export function headerTexts(headers: ParsedHeaders, key: string): string[] {
  const raw = headers.get(key);
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  return list.flatMap((value) => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') {
      return [value.value];
    }
    return [];
  });
}

const BULK = new Set(['bulk', 'junk', 'list', 'auto_reply']);
const AUTO_REPLY_HEADERS = ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress'];
const BOUNCE_SENDER = /^(mailer-daemon|postmaster)@/i;

/**
 * RN-08 (parte dos cabeçalhos): o primeiro motivo que bater, ou `null`. `from` e `ownAddress` já
 * em minúsculas.
 */
export function headerDiscardReason(
  headers: ParsedHeaders,
  from: string,
  ownAddress: string,
): DiscardReason | null {
  const autoSubmitted = headerText(headers, 'auto-submitted')?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto_submitted';

  const precedence = headerText(headers, 'precedence')?.trim().toLowerCase();
  if (precedence && BULK.has(precedence)) return 'bulk';

  if (AUTO_REPLY_HEADERS.some((key) => headers.has(key))) return 'auto_reply';

  if (from === ownAddress) return 'own_address';

  const contentType = headerText(headers, 'content-type')?.toLowerCase();
  if (contentType?.startsWith('multipart/report') || BOUNCE_SENDER.test(from)) return 'bounce';

  // Só o cabeçalho que o próprio Gmail grava (o 1º, no topo) conta; os de baixo vêm do remetente.
  const gmailAuth = headerTexts(headers, 'authentication-results').find((value) =>
    /^\s*mx\.google\.com\b/i.test(value),
  );
  if (gmailAuth && /\bdmarc=fail\b/i.test(gmailAuth)) return 'dmarc_fail';

  return null;
}
