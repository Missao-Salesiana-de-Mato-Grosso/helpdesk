import { describeFailure, isPermanentFailure } from './mailer.js';
import { mailboxAddress } from './notification.service.js';

const smtpError = (responseCode: number, message: string) =>
  Object.assign(new Error(message), { responseCode });

describe('falhas de SMTP (RN-14)', () => {
  it('5xx é definitiva; 4xx, timeout e erro de rede voltam para a fila', () => {
    expect(isPermanentFailure(smtpError(550, 'No such user'))).toBe(true);
    expect(isPermanentFailure(smtpError(421, 'Try again later'))).toBe(false);
    expect(isPermanentFailure(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(
      false,
    );
    expect(isPermanentFailure('falha')).toBe(false);
  });

  it('last_error com o código, até 500 caracteres', () => {
    expect(describeFailure(smtpError(550, 'No such user'))).toBe('550 No such user');
    expect(describeFailure(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(
      'ETIMEDOUT timeout',
    );
    expect(describeFailure(new Error('x'.repeat(900)))).toHaveLength(500);
  });

  it('mailboxAddress extrai o endereço em minúsculas', () => {
    expect(mailboxAddress('Suporte MSMT <Suporte@MissaoSalesiana.org.br>')).toBe(
      'suporte@missaosalesiana.org.br',
    );
    expect(mailboxAddress(' fila@x.org ')).toBe('fila@x.org');
  });
});
