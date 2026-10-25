import { escapeHtml } from '../notifications/templates.js';
import { htmlHasContent, sanitizeHtml } from '../common/sanitize-html.js';
import { splitHtmlReply, splitTextReply } from './reply-splitter.js';

export interface EmailBody {
  bodyHtml: string;
  quotedHtml: string | null;
}

const MAX_HTML_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 100 * 1024;
const EMPTY_BODY = '<p>(e-mail sem texto)</p>';

/** Texto puro → HTML: escape e `<br>`; parágrafos nas linhas em branco. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

const stripHead = (html: string) => html.replace(/<head\b[\s\S]*?<\/head>/gi, '');

/**
 * RN-17 a RN-19: a parte HTML (ou o texto convertido), separada em texto novo e citado,
 * sanitizada, com o aviso dos anexos não importados no fim.
 */
export function emailBody(
  html: string | null,
  text: string | null,
  rejectedAttachments: readonly string[],
): EmailBody {
  let body: EmailBody | null = null;
  let htmlTooLong = false;
  if (html) {
    const split = splitHtmlReply(stripHead(html));
    body = finish(split.body, split.quoted, html);
    htmlTooLong = Buffer.byteLength(body.bodyHtml) > MAX_HTML_BYTES;
    if (htmlTooLong) body = null;
  }
  if (!body) {
    const plain = text ?? '';
    const textTooLong = plain.length > MAX_TEXT_CHARS;
    const split = splitTextReply(textTooLong ? plain.slice(0, MAX_TEXT_CHARS) : plain);
    body = finish(textToHtml(split.body), split.quoted && textToHtml(split.quoted), null);
    if (htmlTooLong || textTooLong) {
      body.bodyHtml += '<p>(e-mail muito longo; o original completo está guardado)</p>';
    }
  }
  if (rejectedAttachments.length > 0) {
    body.bodyHtml += `<p>${escapeHtml(
      `Anexos não importados (tipo não aceito, acima de 20 MB ou além de 5): ${rejectedAttachments.join(', ')}`,
    )}</p>`;
  }
  return body;
}

/** Sanitiza as duas partes; se o corte deixou o corpo vazio, tudo volta para o corpo (RN-18). */
function finish(body: string, quoted: string | null, whole: string | null): EmailBody {
  const cleanBody = sanitizeHtml(body);
  const cleanQuoted = quoted === null ? null : sanitizeHtml(quoted);
  if (htmlHasContent(cleanBody)) {
    return {
      bodyHtml: cleanBody,
      quotedHtml: cleanQuoted && htmlHasContent(cleanQuoted) ? cleanQuoted : null,
    };
  }
  if (cleanQuoted && htmlHasContent(cleanQuoted)) {
    const all = sanitizeHtml(whole === null ? `${body}${quoted ?? ''}` : stripHead(whole));
    return { bodyHtml: all, quotedHtml: null };
  }
  return { bodyHtml: EMPTY_BODY, quotedHtml: null };
}
