import { createHash, randomBytes } from 'node:crypto';

/** T40 RN-14: o banco guarda só o SHA-256 (hex) do token. */
export function hashSurveyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** T40 RN-14: 32 bytes aleatórios em base64url (43 caracteres) e o hash que vai para o banco. */
export function newSurveyToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSurveyToken(token) };
}

/** T40 RN-06 e RN-07: link base do e-mail, com o token no fragmento (nunca no caminho ou na query). */
export function surveyUrl(portalUrl: string, token: string): string {
  return `${portalUrl.replace(/\/+$/, '')}/avaliar#${token}`;
}

/** T40 RN-06: o link de uma nota, que só pré-seleciona a nota na página (RN-08). */
export function surveyScoreUrl(baseUrl: string, score: number): string {
  const hash = baseUrl.indexOf('#');
  if (hash === -1) return `${baseUrl}?nota=${score}`;
  return `${baseUrl.slice(0, hash)}?nota=${score}${baseUrl.slice(hash)}`;
}
