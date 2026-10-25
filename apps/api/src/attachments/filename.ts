const MAX_FILENAME_LENGTH = 255;
// Remover caracteres de controle é o objetivo desta expressão.
// oxlint-disable-next-line no-control-regex
const CONTROL_AND_QUOTES = /[\u0000-\u001f\u007f"]/g;

/**
 * Nome exibido e usado no download: sem caminho, sem caracteres de controle nem aspas, até 255
 * caracteres (preservando a extensão). Vazio vira "arquivo".
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const clean = base.replace(CONTROL_AND_QUOTES, '').replace(/\s+/g, ' ').trim();
  if (clean === '' || clean === '.' || clean === '..') return 'arquivo';
  if (clean.length <= MAX_FILENAME_LENGTH) return clean;
  const extension = /\.[a-z0-9]{1,10}$/i.exec(clean)?.[0] ?? '';
  return clean.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
}
