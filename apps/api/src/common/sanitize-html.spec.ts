import {
  htmlHasContent,
  referencedImageIds,
  sanitizeHtml,
  sanitizeSignatureHtml,
} from './sanitize-html.js';

describe('sanitizeHtml (spec T08–T10 §7)', () => {
  it('remove script, eventos, style, class e id', () => {
    expect(
      sanitizeHtml(
        '<p class="x" id="y" style="color:red" onclick="a()">oi</p><script>x()</script>',
      ),
    ).toBe('<p>oi</p>');
  });

  it('CT-37 remove href javascript: e força target/rel nos links', () => {
    expect(sanitizeHtml('<p>oi</p><script>x()</script><a href="javascript:alert(1)">l</a>')).toBe(
      '<p>oi</p><a target="_blank" rel="noopener noreferrer">l</a>',
    );
    expect(sanitizeHtml('<a href="https://x.org" target="_self">x</a>')).toBe(
      '<a href="https://x.org" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('aceita mailto em links e só http(s) em imagens; cid: some', () => {
    expect(sanitizeHtml('<a href="mailto:a@b.c">m</a>')).toContain('href="mailto:a@b.c"');
    expect(sanitizeHtml('<img src="https://x.org/a.png" alt="a">')).toBe(
      '<img src="https://x.org/a.png" alt="a" />',
    );
    expect(sanitizeHtml('<img src="cid:abc">')).toBe('');
    expect(sanitizeHtml('<img src="data:image/png;base64,AAA">')).toBe('');
  });

  it('mantém tabelas com colspan e descarta tags fora da allowlist', () => {
    expect(
      sanitizeHtml('<table><tr><td colspan="2">a</td></tr></table><iframe src="x"></iframe>'),
    ).toBe('<table><tr><td colspan="2">a</td></tr></table>');
  });
});

describe('sanitizeSignatureHtml (spec T31)', () => {
  it('CT-17 keeps only what the portal editor produces', () => {
    expect(
      sanitizeSignatureHtml(
        '<p style="color:red"><strong>João</strong> <em>Silva</em></p>' +
          '<script>x()</script><img src="https://x.org/logo.png">' +
          '<table><tr><td>cel</td></tr></table><h1>Título</h1><hr><pre>pre</pre>' +
          '<ul><li>TI</li></ul><a href="javascript:alert(1)">ruim</a>' +
          '<a href="https://msmt.org.br">site</a>',
      ),
    ).toBe(
      '<p><strong>João</strong> <em>Silva</em></p>celTítulopre<ul><li>TI</li></ul>' +
        '<a target="_blank" rel="noopener noreferrer">ruim</a>' +
        '<a href="https://msmt.org.br" target="_blank" rel="noopener noreferrer">site</a>',
    );
  });

  it('CT-17 no visible text left → null', () => {
    expect(sanitizeSignatureHtml('')).toBeNull();
    expect(sanitizeSignatureHtml('<p> &nbsp; </p>')).toBeNull();
    expect(sanitizeSignatureHtml('<img src="https://x.org/logo.png">')).toBeNull();
    expect(sanitizeSignatureHtml('<script>x()</script>')).toBeNull();
  });
});

describe('imagens no texto (spec T32)', () => {
  const ids: Record<string, string> = { a: 'id-a', b: 'id-b' };
  const byKey = (attribs: Record<string, string>) => ids[attribs['data-inline-key'] ?? ''];

  it('CT-17 troca a chave conhecida pelo id do anexo, sem src', () => {
    expect(sanitizeHtml('<p>x</p><img data-inline-key="a" alt="print" width="9">', byKey)).toBe(
      '<p>x</p><img data-attachment-id="id-a" alt="print" />',
    );
  });

  it('CT-17 descarta chave desconhecida, data-attachment-id do cliente, data: e blob:', () => {
    expect(sanitizeHtml('<img data-inline-key="zzz">', byKey)).toBe('');
    expect(sanitizeHtml('<img data-attachment-id="outro">', byKey)).toBe('');
    expect(sanitizeHtml('<img data-attachment-id="outro">')).toBe('');
    expect(sanitizeHtml('<img src="data:image/png;base64,AAA" data-inline-key="zzz">', byKey)).toBe(
      '',
    );
    expect(sanitizeHtml('<img src="blob:https://x/1">', byKey)).toBe('');
  });

  it('CT-17 mantém imagem https e remove o atributo forjado dela', () => {
    expect(sanitizeHtml('<img src="https://x.org/a.png" data-attachment-id="forjado">')).toBe(
      '<img src="https://x.org/a.png" />',
    );
  });

  it('CT-17 lista os ids referenciados, sem repetir', () => {
    const html = sanitizeHtml(
      '<img data-inline-key="b"><p>t</p><img data-inline-key="a"><img data-inline-key="b">',
      byKey,
    );
    expect(referencedImageIds(html)).toEqual(['id-b', 'id-a']);
    expect(htmlHasContent(html)).toBe(true);
  });
});

describe('htmlHasContent', () => {
  it('detecta corpo vazio depois de sanitizar', () => {
    expect(htmlHasContent(sanitizeHtml('<p> &nbsp; </p>'))).toBe(false);
    expect(htmlHasContent(sanitizeHtml('<img src="cid:abc">'))).toBe(false);
    expect(htmlHasContent(sanitizeHtml('<p>ok</p>'))).toBe(true);
    expect(htmlHasContent(sanitizeHtml('<img src="https://x.org/a.png">'))).toBe(true);
  });
});
