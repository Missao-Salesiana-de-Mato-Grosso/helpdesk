import { simpleParser } from 'mailparser';
import { recipientAddresses } from './recipients.js';

const parse = (headers: string[]) =>
  simpleParser(
    [
      'From: Fornecedor <compras@fornecedor.com.br>',
      ...headers,
      'Subject: Cadastro',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Corpo',
      '',
    ].join('\n'),
  );

describe('destinatários do e-mail (caixa de entrada por grupo)', () => {
  it('To e Cc primeiro, em minúsculas e sem repetição', async () => {
    const parsed = await parse([
      'To: "Cadastros" <Cadastros@MissaoSalesiana.org.br>, outro@empresa.com',
      'Cc: cadastros@missaosalesiana.org.br, financeiro@missaosalesiana.org.br',
    ]);
    expect(recipientAddresses(parsed)).toEqual([
      'cadastros@missaosalesiana.org.br',
      'outro@empresa.com',
      'financeiro@missaosalesiana.org.br',
    ]);
  });

  it('encaminhado pelo Gmail: o destino original vem nos cabeçalhos de encaminhamento', async () => {
    const parsed = await parse([
      'Delivered-To: suporte@missaosalesiana.org.br',
      'X-Forwarded-To: suporte@missaosalesiana.org.br',
      'X-Forwarded-For: cadastros@missaosalesiana.org.br suporte@missaosalesiana.org.br',
      'Delivered-To: cadastros@missaosalesiana.org.br',
      'To: undisclosed-recipients:;',
    ]);
    expect(recipientAddresses(parsed)).toEqual([
      'cadastros@missaosalesiana.org.br',
      'suporte@missaosalesiana.org.br',
    ]);
  });

  it('sem destinatário: lista vazia', async () => {
    expect(recipientAddresses(await parse([]))).toEqual([]);
  });
});
