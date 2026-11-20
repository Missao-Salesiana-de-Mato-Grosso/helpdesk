// Spec docs/specs/T39-desligamento-zitadel.md — assinatura das chamadas do Zitadel.
import { createHmac } from 'node:crypto';
import { signZitadelPayload, verifyZitadelSignature } from './zitadel-signature.js';

const KEY = 'chave-do-target';
const now = new Date('2026-11-20T12:00:00Z');
const body = Buffer.from('{"aggregateID":"1","event_type":"user.deactivated"}');
const t = Math.floor(now.getTime() / 1000);
const hmac = (key: string, payload: Buffer | string, at = t) =>
  createHmac('sha256', key).update(`${at}.`).update(payload).digest('hex');

describe('verifyZitadelSignature (T39)', () => {
  it('CT-01 aceita a assinatura do Zitadel, inclusive com duas chaves na rotação', () => {
    expect(verifyZitadelSignature(`t=${t},v1=${hmac(KEY, body)}`, body, KEY, now)).toBe(true);
    expect(
      verifyZitadelSignature(
        `t=${t},v1=${hmac('outra', body)},v1=${hmac(KEY, body)}`,
        body,
        KEY,
        now,
      ),
    ).toBe(true);
    expect(verifyZitadelSignature(signZitadelPayload(body, KEY, now), body, KEY, now)).toBe(true);
  });

  it('CT-01 recusa corpo alterado, chave errada, fora da janela e cabeçalho inválido', () => {
    const header = `t=${t},v1=${hmac(KEY, body)}`;
    expect(verifyZitadelSignature(header, Buffer.from('{}'), KEY, now)).toBe(false);
    expect(verifyZitadelSignature(header, body, 'errada', now)).toBe(false);
    const late = new Date(now.getTime() + 301_000);
    const early = new Date(now.getTime() - 301_000);
    expect(verifyZitadelSignature(header, body, KEY, late)).toBe(false);
    expect(verifyZitadelSignature(header, body, KEY, early)).toBe(false);
    expect(verifyZitadelSignature(header, body, KEY, new Date(now.getTime() + 299_000))).toBe(true);
    for (const bad of [undefined, '', `t=${t}`, `v1=${hmac(KEY, body)}`, 'lixo', `t=x,v1=zz`]) {
      expect(verifyZitadelSignature(bad, body, KEY, now)).toBe(false);
    }
    expect(verifyZitadelSignature(header, body, '', now)).toBe(false);
  });
});
