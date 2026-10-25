/** Texto novo e trecho citado de uma resposta (RN-18). `quoted` = null quando não há corte. */
export interface SplitReply {
  body: string;
  quoted: string | null;
}

// Onde cada cliente de e-mail começa a citação, na parte HTML.
const HTML_MARKERS: RegExp[] = [
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b/i,
  /<blockquote\b[^>]*\btype\s*=\s*["']?cite\b/i,
  /<div\b[^>]*\bid\s*=\s*["']?(?:appendonsend|divRplyFwdMsg)\b/i,
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-cite-prefix\b/i,
  /-{4,}\s*(?:Original Message|Mensagem original)\s*-{4,}/i,
];

const ATTRIBUTION = /^(?:Em|On)\b.{0,300}\b(?:escreveu|wrote):\s*$/i;
const ORIGINAL = /^-{2,}\s*(?:Original Message|Mensagem original)\s*-{2,}\s*$/i;
const OUTLOOK_FROM = /^\*?(?:De|From):\*?\s.+/i;
const OUTLOOK_NEXT = /^\*?(?:Enviado|Enviada|Enviado em|Sent|Data|Date):\*?\s/i;

/** HTML: corta no primeiro marcador conhecido. O que sobra fora de ordem, a sanitização conserta. */
export function splitHtmlReply(html: string): SplitReply {
  let cut = -1;
  for (const marker of HTML_MARKERS) {
    const index = html.search(marker);
    if (index !== -1 && (cut === -1 || index < cut)) cut = index;
  }
  if (cut <= 0) return { body: html, quoted: null };
  return { body: html.slice(0, cut), quoted: html.slice(cut) };
}

/** Texto puro: corta na linha de atribuição ("Em …, … escreveu:"), no "Original Message" ou no "De:/Enviado:". */
export function splitTextReply(text: string): SplitReply {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    // O Gmail quebra a atribuição longa em duas linhas.
    const joined = `${line} ${lines[i + 1]?.trim() ?? ''}`.trim();
    const isCut =
      ATTRIBUTION.test(line) ||
      (/^(?:Em|On)\b/i.test(line) && ATTRIBUTION.test(joined)) ||
      ORIGINAL.test(line) ||
      (OUTLOOK_FROM.test(line) &&
        lines.slice(i + 1, i + 5).some((next) => OUTLOOK_NEXT.test(next.trim())));
    if (isCut && i > 0) {
      return { body: lines.slice(0, i).join('\n'), quoted: lines.slice(i).join('\n') };
    }
  }
  return { body: text, quoted: null };
}
