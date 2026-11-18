import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, attachmentMimeType } from '@helpdesk/shared';

/**
 * Corpo da requisição: JSON sem arquivos; com arquivos, multipart (`data` = JSON, `files` e as
 * imagens do texto em `inline`, T32).
 */
export function requestBody(
  data: object,
  files: readonly File[],
  inline: readonly File[] = [],
): string | FormData {
  if (files.length === 0 && inline.length === 0) return JSON.stringify(data);
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  for (const file of files) form.append('files', file);
  for (const file of inline) form.append('inline', file);
  return form;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Junta os arquivos escolhidos aos que já estavam, com as mesmas regras da API (que valida de
 * novo): extensão aceita, até 20 MB e até 5 por mensagem. Devolve os aceitos e os motivos dos recusados.
 */
export function addFiles(
  current: readonly File[],
  picked: readonly File[],
): { files: File[]; errors: string[] } {
  const files = [...current];
  const errors: string[] = [];
  for (const file of picked) {
    if (!attachmentMimeType(file.name)) {
      errors.push(`${file.name}: tipo de arquivo não aceito.`);
    } else if (file.size > ATTACHMENT_MAX_BYTES) {
      errors.push(`${file.name}: passa de ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
    } else if (files.length >= ATTACHMENT_MAX_FILES) {
      errors.push(`${file.name}: no máximo ${ATTACHMENT_MAX_FILES} arquivos por mensagem.`);
    } else {
      files.push(file);
    }
  }
  return { files, errors };
}
