#!/usr/bin/env node
// oxlint-disable no-console -- script de CLI: a saída no terminal é o objetivo
// Decodifica o payload de um JWT (sem validar a assinatura) e mascara valores pessoais,
// para colar os claims reais em docs/specs/T04-T05-auth-jit.md §10.
//
// Uso (macOS, token copiado do header Authorization no DevTools → Network → /api/me):
//   pbpaste | node deploy/local/decode-jwt.mjs
// Aceita "Bearer <jwt>" ou só o "<jwt>". O token nunca é impresso.
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf8')
  .trim()
  .replace(/^Bearer\s+/i, '');
const parts = input.split('.');
if (parts.length !== 3) {
  console.error('✖ Entrada não parece um JWT (esperado header.payload.assinatura).');
  process.exit(1);
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const header = decode(parts[0]);
const payload = decode(parts[1]);

// IDs e e-mails viram placeholders; estrutura, nomes de claims e roles ficam intactos.
const MASK = new Set([
  'sub',
  'jti',
  'sid',
  'email',
  'name',
  'given_name',
  'family_name',
  'preferred_username',
]);
const mask = (key, value) => {
  if (MASK.has(key) && typeof value === 'string') return `<${key}>`;
  if (key === 'client_id' || key === 'azp') return '<client-id>';
  return value;
};
const masked = JSON.parse(JSON.stringify(payload), mask);

console.log(
  JSON.stringify(
    { header: { alg: header.alg, typ: header.typ, kid: '<kid>' }, payload: masked },
    null,
    2,
  ),
);
