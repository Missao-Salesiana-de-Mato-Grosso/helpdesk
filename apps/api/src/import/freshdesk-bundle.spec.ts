import {
  DEFAULT_GROUP_RULES,
  extractInlineImages,
  groupNameFor,
  mapPriority,
  normalizeSubject,
  splitQuote,
} from './freshdesk-bundle.js';

describe('pacote do Freshdesk (T29)', () => {
  it('prioridade: "baixa", o padrão de lá, vira média; alta e urgente se mantêm', () => {
    expect([1, 2, 3, 4].map(mapPriority)).toEqual(['medium', 'medium', 'high', 'urgent']);
  });

  it('assunto comparável ignora Re/Fwd/Enc, [#123], espaços e maiúsculas', () => {
    expect(normalizeSubject('RE: Enc:  Senha   do e-mail [#18277]')).toBe('senha do e-mail');
    expect(normalizeSubject('Fwd: Re: Impressora')).toBe(normalizeSubject('impressora'));
  });

  it('imagem colada vira aviso no texto e arquivo para anexar', () => {
    const html =
      '<p>Veja:</p><img alt="x" src="fd-inline:18277/inline-1.png" width="300"><img src="fd-inline-missing:">' +
      '<img src="https://ci3.googleusercontent.com/assinatura.png">';
    const result = extractInlineImages(html);
    expect(result.files).toEqual(['18277/inline-1.png']);
    expect(result.html).toBe(
      '<p>Veja:</p>[imagem colada: inline-1.png, nos anexos][imagem colada indisponível]' +
        '<img src="https://ci3.googleusercontent.com/assinatura.png">',
    );
  });

  it('citação: o marcador do Freshdesk primeiro, depois o do Gmail', () => {
    expect(splitQuote('<p>Novo</p><div class="freshdesk_quote"><p>Antigo</p></div>')).toEqual({
      body: '<p>Novo</p>',
      quoted: '<div class="freshdesk_quote"><p>Antigo</p></div>',
    });
    expect(splitQuote('<p>Oi</p><div class="gmail_quote">x</div>').quoted).toContain('gmail_quote');
    expect(splitQuote('<p>Só texto</p>')).toEqual({ body: '<p>Só texto</p>', quoted: null });
  });

  it('grupo: pelo nome no Freshdesk; sem grupo, pela caixa de destino; senão nulo', () => {
    const rules = DEFAULT_GROUP_RULES;
    expect(groupNameFor({ group: 'Suporte TI - Sede Inspetorial', toEmails: [] }, rules)).toBe(
      'Suporte TI',
    );
    expect(
      groupNameFor(
        { group: null, toEmails: ['"Cadastros" <Cadastros@missaosalesiana.org.br>'] },
        rules,
      ),
    ).toBe('Cadastros');
    expect(
      groupNameFor({ group: null, toEmails: ['suporte@missaosalesiana.org.br'] }, rules),
    ).toBeNull();
    expect(groupNameFor({ group: 'DPO/LGPD', toEmails: [] }, rules)).toBeNull();
  });
});
