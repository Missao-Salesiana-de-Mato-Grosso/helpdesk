import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cabeçalho que o Zitadel v4.19.5 envia (`pkg/actions/signing.go`). */
export const ZITADEL_SIGNATURE_HEADER = 'zitadel-signature';

/** Janela aceita entre o `t` do cabeçalho e o relógio do servidor, como o verificador do Zitadel. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * T39 RN-01: confere `t=<unix>,v1=<hex>[,v1=<hex>...]` — HMAC-SHA256 de `"<t>.<corpo>"` com a chave
 * do target. Vale se qualquer `v1` bater (rotação de chave). Comparação em tempo constante.
 */
export function verifyZitadelSignature(
  header: string | undefined,
  body: Buffer,
  signingKey: string,
  now: Date = new Date(),
): boolean {
  if (!header || !signingKey) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (!value) continue;
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', signingKey).update(`${timestamp}.`).update(body).digest();
  return signatures.some((signature) => {
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Cabeçalho como o Zitadel monta (`ComputeSignatureHeader`), para os testes. */
export function signZitadelPayload(body: string | Buffer, signingKey: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', signingKey).update(`${t}.`).update(body).digest('hex');
  return `t=${t},v1=${v1}`;
}
