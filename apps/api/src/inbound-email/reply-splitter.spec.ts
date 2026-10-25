import { splitHtmlReply, splitTextReply } from './reply-splitter.js';

describe('separador de resposta (CT-22, RN-18)', () => {
  it.each([
    [
      'Gmail',
      '<div dir="ltr">Novo</div><div class="gmail_quote"><blockquote>Antigo</blockquote></div>',
    ],
    ['Apple Mail', '<div>Novo</div><blockquote type="cite"><div>Antigo</div></blockquote>'],
    ['Outlook web', '<div>Novo</div><div id="appendonsend"></div><div>Antigo</div>'],
    ['Outlook', '<div>Novo</div><hr><div id="divRplyFwdMsg">De: x</div><div>Antigo</div>'],
    ['Thunderbird', '<p>Novo</p><div class="moz-cite-prefix">Em 24/10, x escreveu:</div>Antigo'],
    ['Outlook texto no HTML', '<p>Novo</p><p>-----Original Message-----</p><p>Antigo</p>'],
  ])('HTML do %s: corta no marcador', (_client, html) => {
    const split = splitHtmlReply(html);
    expect(split.body).toContain('Novo');
    expect(split.body).not.toContain('Antigo');
    expect(split.quoted).toContain('Antigo');
  });

  it('HTML sem marcador fica inteiro; marcador no início não corta', () => {
    expect(splitHtmlReply('<p>Só texto</p>')).toEqual({ body: '<p>Só texto</p>', quoted: null });
    const quoteOnly = '<div class="gmail_quote">Antigo</div>';
    expect(splitHtmlReply(quoteOnly)).toEqual({ body: quoteOnly, quoted: null });
  });

  it.each([
    [
      'Gmail pt-BR',
      'Novo\n\nEm sáb., 24 de out. de 2026 às 09:30, Suporte <s@x.org> escreveu:\n> Antigo',
    ],
    [
      'Gmail quebrado em 2 linhas',
      'Novo\n\nEm sáb., 24 de out. de 2026 às 09:30, Suporte <\ns@x.org> escreveu:\n> Antigo',
    ],
    ['inglês', 'Novo\n\nOn Sat, Oct 24, 2026 at 9:30 AM Suporte <s@x.org> wrote:\n> Antigo'],
    ['Original Message', 'Novo\n-----Original Message-----\nAntigo'],
    ['Outlook De/Enviado', 'Novo\n\nDe: Suporte <s@x.org>\nEnviado: sábado, 24 de outubro\nAntigo'],
  ])('texto do %s: corta na atribuição', (_client, text) => {
    const split = splitTextReply(text);
    expect(split.body.trim()).toBe('Novo');
    expect(split.quoted).toContain('Antigo');
  });

  it('texto sem marcador, ou com "De:" solto, fica inteiro', () => {
    const text = 'De: amanhã cedo eu ligo.\nObrigado';
    expect(splitTextReply(text)).toEqual({ body: text, quoted: null });
  });
});
