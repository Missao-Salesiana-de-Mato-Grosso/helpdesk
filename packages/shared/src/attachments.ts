// Regras de anexos (T13), usadas pela API (validação) e pelo front (validação antes do envio).

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 5;

/**
 * Extensões aceitas e o tipo MIME gravado para cada uma. A extensão manda: o tipo informado pelo
 * navegador varia (CSV, EML) e não é confiável. O download sempre sai como anexo, com `nosniff`.
 */
export const ATTACHMENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
  eml: 'message/rfc822',
} as const satisfies Record<string, string>;

export type AttachmentExtension = keyof typeof ATTACHMENT_TYPES;

/** Valor do `accept` do `<input type="file">`. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');

const isAttachmentExtension = (value: string): value is AttachmentExtension =>
  Object.hasOwn(ATTACHMENT_TYPES, value);

/** Tipo MIME gravado para o nome de arquivo, ou `null` se a extensão não é aceita. */
export function attachmentMimeType(filename: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  return extension && isAttachmentExtension(extension) ? ATTACHMENT_TYPES[extension] : null;
}

// ── Imagens no texto (T32) ────────────────────────────────────────────────────

/** RN-04: cada imagem inserida no texto. */
export const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** RN-05: imagens no texto por mensagem, contadas à parte dos anexos comuns. */
export const INLINE_IMAGE_MAX_FILES = 10;

/** RN-03: extensões aceitas como imagem no texto. */
export const INLINE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/** Valor do `accept` do seletor de imagem do editor. */
export const INLINE_IMAGE_ACCEPT = INLINE_IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(
  ',',
);

/** Tipo MIME de uma imagem aceita no texto, ou `null`. */
export function inlineImageMimeType(filename: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  return extension && (INLINE_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
    ? attachmentMimeType(filename)
    : null;
}

// ── Imagens da assinatura (T33) ───────────────────────────────────────────────

/** RN-03: cada imagem da assinatura. */
export const SIGNATURE_IMAGE_MAX_BYTES = 200 * 1024;
/** RN-04: imagens que a assinatura gravada referencia. */
export const SIGNATURE_IMAGE_MAX_FILES = 2;
/** RN-02: extensões aceitas na assinatura. */
export const SIGNATURE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const;

/** Valor do `accept` do seletor de imagem da assinatura. */
export const SIGNATURE_IMAGE_ACCEPT = SIGNATURE_IMAGE_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(',');

/** Tipo MIME de uma imagem aceita na assinatura, ou `null`. */
export function signatureImageMimeType(filename: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  return extension && (SIGNATURE_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
    ? attachmentMimeType(filename)
    : null;
}

/** Chave que o cliente dá a cada imagem no `bodyHtml` (`data-inline-key`), até o servidor gravar. */
export const INLINE_IMAGE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
