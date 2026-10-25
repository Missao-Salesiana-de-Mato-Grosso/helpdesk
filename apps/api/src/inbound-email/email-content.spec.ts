import { emailBody, textToHtml } from './email-content.js';

describe('corpo do e-mail (RN-17 a RN-19)', () => {
  it('HTML: sanitizado, sem head, script nem style; citação separada', () => {
    const body = emailBody(
      '<html><head><title>T</title><style>p{}</style></head><body><p>Novo <b>x</b></p><script>alert(1)</script><div class="gmail_quote">Antigo</div></body></html>',
      'Novo x',
      [],
    );
    expect(body.bodyHtml).toBe('<p>Novo <b>x</b></p>');
    expect(body.quotedHtml).toContain('Antigo');
  });

  it('CT-18 texto puro: escape e <br>; nada executável', () => {
    expect(textToHtml('a <script>x</script>\nb\n\nc')).toBe(
      '<p>a &lt;script&gt;x&lt;/script&gt;<br>b</p><p>c</p>',
    );
    const body = emailBody(null, 'Oi <script>alert(1)</script>', []);
    expect(body.bodyHtml).not.toContain('<script');
    expect(body.bodyHtml).toContain('&lt;script&gt;');
  });

  it('CT-19 sem texto → "(e-mail sem texto)"', () => {
    expect(emailBody('<div><img src="cid:x"></div>', '', []).bodyHtml).toBe(
      '<p>(e-mail sem texto)</p>',
    );
    expect(emailBody(null, null, []).bodyHtml).toBe('<p>(e-mail sem texto)</p>');
  });

  it('corte que esvazia o corpo: tudo volta para o corpo', () => {
    const body = emailBody('<div class="gmail_quote"><p>Só citação</p></div>', '', []);
    expect(body.bodyHtml).toContain('Só citação');
    expect(body.quotedHtml).toBeNull();
  });

  it('RN-19 anexos não importados listados no fim, com escape', () => {
    const body = emailBody('<p>Oi</p>', null, ['programa.exe', '<b>.bat']);
    expect(body.bodyHtml).toBe(
      '<p>Oi</p><p>Anexos não importados (tipo não aceito, acima de 20 MB ou além de 5): programa.exe, &lt;b&gt;.bat</p>',
    );
  });

  it('HTML acima de 512 KB usa o texto, com a nota', () => {
    const body = emailBody(`<p>${'a'.repeat(600 * 1024)}</p>`, 'Versão texto', []);
    expect(body.bodyHtml).toBe(
      '<p>Versão texto</p><p>(e-mail muito longo; o original completo está guardado)</p>',
    );
  });
});
