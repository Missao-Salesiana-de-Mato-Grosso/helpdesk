import sanitize from 'sanitize-html';

/**
 * T32: o id do anexo de uma imagem do texto (`<img data-attachment-id>`, sem `src`). Só o
 * servidor escreve este atributo (RN-07); o que vier na entrada é descartado.
 */
export const IMAGE_ATTRIBUTE = 'data-attachment-id';

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
    img: ['src', 'alt', 'width', 'height', IMAGE_ATTRIBUTE],
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
  exclusiveFilter: (frame) =>
    frame.tag === 'img' && !frame.attribs['src'] && !frame.attribs[IMAGE_ATTRIBUTE],
};

/**
 * T32: liga uma `<img>` da entrada a um anexo inline. Recebe os atributos originais da tag e
 * devolve o id do anexo, ou `undefined` para tratá-la como imagem comum.
 */
export type InlineImageResolver = (attribs: Record<string, string>) => string | undefined;

/** Sanitiza HTML de usuário antes de gravar. Nunca grave `body_html` sem passar por aqui. */
export function sanitizeHtml(html: string, resolveImage?: InlineImageResolver): string {
  return sanitize(html, {
    ...OPTIONS,
    transformTags: {
      ...OPTIONS.transformTags,
      img: (tagName, attribs) => {
        const id = resolveImage?.(attribs);
        if (id) {
          const alt = attribs['alt'];
          return { tagName, attribs: { [IMAGE_ATTRIBUTE]: id, ...(alt ? { alt } : {}) } };
        }
        const { [IMAGE_ATTRIBUTE]: _ignored, ...rest } = attribs;
        return { tagName, attribs: rest };
      },
    },
  }).trim();
}

/** T32: ids dos anexos que o HTML já sanitizado referencia, na ordem em que aparecem. */
export function referencedImageIds(html: string): string[] {
  const ids = [...html.matchAll(/<img\b[^>]*\sdata-attachment-id="([^"]+)"/gi)].map((m) => m[1]!);
  return [...new Set(ids)];
}

/**
 * T33: o id de uma imagem da assinatura (`<img data-signature-image-id>`, sem `src`). Como o
 * `data-attachment-id`, só o servidor escreve este atributo (RN-05).
 */
export const SIGNATURE_IMAGE_ATTRIBUTE = 'data-signature-image-id';

// T31 RN-04: a assinatura aceita só o que o editor do portal produz. Sem tabelas, títulos nem
// `pre`; imagem só na forma da T33 (RN-05).
const SIGNATURE_OPTIONS: sanitize.IOptions = {
  ...OPTIONS,
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
    'code',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: [SIGNATURE_IMAGE_ATTRIBUTE, 'alt'],
  },
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs[SIGNATURE_IMAGE_ATTRIBUTE],
};

/**
 * Sanitiza a assinatura de e-mail (T31). Sem conteúdo → `null` (RN-05); uma imagem sozinha
 * conta como conteúdo (T33 RN-07). `resolveImage` devolve o id da imagem da assinatura que a
 * `<img>` representa; sem id, a imagem some.
 */
export function sanitizeSignatureHtml(
  html: string,
  resolveImage?: InlineImageResolver,
): string | null {
  const clean = sanitize(html, {
    ...SIGNATURE_OPTIONS,
    transformTags: {
      ...SIGNATURE_OPTIONS.transformTags,
      img: (tagName, attribs) => {
        const id = resolveImage?.(attribs);
        const alt = attribs['alt'];
        return {
          tagName,
          attribs: id ? { [SIGNATURE_IMAGE_ATTRIBUTE]: id, ...(alt ? { alt } : {}) } : {},
        };
      },
    },
  }).trim();
  return htmlHasContent(clean) ? clean : null;
}

/** T33: ids das imagens que a assinatura já sanitizada referencia, sem repetir. */
export function referencedSignatureImageIds(html: string): string[] {
  const ids = [...html.matchAll(/<img\b[^>]*\sdata-signature-image-id="([^"]+)"/gi)].map(
    (m) => m[1]!,
  );
  return [...new Set(ids)];
}

/** Texto visível do HTML (sem tags e espaços), para detectar corpo vazio (RN-33). */
export function htmlHasContent(html: string): boolean {
  const text = sanitize(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length > 0 || /<img\s/i.test(html);
}
