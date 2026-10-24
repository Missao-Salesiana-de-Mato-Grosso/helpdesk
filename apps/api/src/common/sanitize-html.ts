import sanitize from 'sanitize-html';

// Allowlist da spec T08–T10 §7. Reutilizada pelo canal de e-mail (T21).
const OPTIONS: sanitize.IOptions = {
  allowedTags: [
    'p',
    'br',
    'div',
    'span',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: [],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'], img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitize.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs['src'],
};

/** Sanitiza HTML de usuário antes de gravar. Nunca grave `body_html` sem passar por aqui. */
export function sanitizeHtml(html: string): string {
  return sanitize(html, OPTIONS).trim();
}

/** Texto visível do HTML (sem tags e espaços), para detectar corpo vazio (RN-33). */
export function htmlHasContent(html: string): boolean {
  const text = sanitize(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length > 0 || /<img\s/i.test(html);
}
