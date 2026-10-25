import { headerDiscardReason } from './loop-guard.js';

const OWN = 'suporte@missaosalesiana.org.br';
const check = (headers: Record<string, unknown>, from = 'maria@x.org') =>
  headerDiscardReason(new Map(Object.entries(headers)), from, OWN);

describe('anti-loop (CT-23, RN-08 e RN-09)', () => {
  it('e-mail comum passa', () => {
    expect(check({ 'auto-submitted': 'no', 'content-type': { value: 'text/plain' } })).toBeNull();
  });

  it.each([
    [{ 'auto-submitted': 'auto-replied' }, 'auto_submitted'],
    [{ 'auto-submitted': 'Auto-Generated' }, 'auto_submitted'],
    [{ precedence: 'bulk' }, 'bulk'],
    [{ precedence: 'auto_reply' }, 'bulk'],
    [{ precedence: 'list' }, 'bulk'],
    [{ 'x-autoreply': 'yes' }, 'auto_reply'],
    [{ 'x-autorespond': 'x' }, 'auto_reply'],
    [{ 'x-auto-response-suppress': 'All' }, 'auto_reply'],
    [
      {
        'content-type': { value: 'multipart/report', params: { 'report-type': 'delivery-status' } },
      },
      'bounce',
    ],
  ])('%o → %s', (headers, reason) => {
    expect(check(headers)).toBe(reason);
  });

  it('remetente: a própria caixa e mailer-daemon', () => {
    expect(check({}, OWN)).toBe('own_address');
    expect(check({}, 'mailer-daemon@googlemail.com')).toBe('bounce');
    expect(check({}, 'postmaster@x.org')).toBe('bounce');
  });

  it('dmarc=fail só conta no cabeçalho do mx.google.com', () => {
    expect(
      check({
        'authentication-results':
          'mx.google.com; spf=softfail; dmarc=fail (p=NONE) header.from=missaosalesiana.org.br',
      }),
    ).toBe('dmarc_fail');
    expect(
      check({
        'authentication-results': [
          'mx.google.com; dmarc=pass header.from=x.org',
          'mx.falso.com; dmarc=fail',
        ],
      }),
    ).toBeNull();
    expect(check({ 'authentication-results': 'mx.falso.com; dmarc=fail' })).toBeNull();
  });

  it('RN-09: a primeira regra que bater define o motivo', () => {
    expect(check({ 'auto-submitted': 'auto-replied', precedence: 'bulk' }, OWN)).toBe(
      'auto_submitted',
    );
    expect(check({ precedence: 'junk' }, OWN)).toBe('bulk');
  });
});
