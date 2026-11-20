import { TICKET_MATCH_END, TICKET_MATCH_START } from '@helpdesk/shared';

export interface SnippetPart {
  text: string;
  /** Parte encontrada pela busca (vai em `<mark>`). */
  hit: boolean;
}

/**
 * Spec T38 RN-10: separa o trecho pelos marcadores da API em partes de texto puro. Quem renderiza
 * usa as partes como texto do React, nunca como HTML.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let hit = false;
  let current = '';
  const flush = () => {
    if (current) parts.push({ text: current, hit });
    current = '';
  };
  for (const char of snippet) {
    if (char === TICKET_MATCH_START || char === TICKET_MATCH_END) {
      flush();
      hit = char === TICKET_MATCH_START;
    } else {
      current += char;
    }
  }
  flush();
  return parts;
}
