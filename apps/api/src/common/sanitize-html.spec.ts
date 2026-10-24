import { htmlHasContent, sanitizeHtml } from './sanitize-html.js';

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

describe('htmlHasContent', () => {
  it('detecta corpo vazio depois de sanitizar', () => {
    expect(htmlHasContent(sanitizeHtml('<p> &nbsp; </p>'))).toBe(false);
    expect(htmlHasContent(sanitizeHtml('<img src="cid:abc">'))).toBe(false);
    expect(htmlHasContent(sanitizeHtml('<p>ok</p>'))).toBe(true);
    expect(htmlHasContent(sanitizeHtml('<img src="https://x.org/a.png">'))).toBe(true);
  });
});
