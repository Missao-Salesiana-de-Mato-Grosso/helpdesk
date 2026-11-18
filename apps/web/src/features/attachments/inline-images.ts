import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_MAX_FILES,
  inlineImageMimeType,
} from '@helpdesk/shared';
import { useEffect, useState } from 'react';

/** `data-inline-key` das imagens que o editor inseriu (T32). */
const INLINE_KEY = /<img\b[^>]*\sdata-inline-key="([^"]+)"/gi;

/** Chaves das imagens no HTML do editor, sem repetir, na ordem em que aparecem. */
export function inlineKeysIn(html: string): string[] {
  return [...new Set([...html.matchAll(INLINE_KEY)].map((match) => match[1]!))];
}

/**
 * T32 RN-24: tipo, tamanho e quantidade, com as mesmas regras da API (que valida de novo).
 * `current` é quantas imagens o texto já tem. Devolve o motivo da recusa, ou `null`.
 */
export function inlineImageError(file: File, current: number): string | null {
  if (!inlineImageMimeType(file.name)) {
    return `${file.name}: só imagens PNG, JPG, GIF ou WebP no texto.`;
  }
  if (file.size > INLINE_IMAGE_MAX_BYTES) {
    return `${file.name}: imagem acima de ${INLINE_IMAGE_MAX_BYTES / 1024 / 1024} MB.`;
  }
  if (current >= INLINE_IMAGE_MAX_FILES) {
    return `No máximo ${INLINE_IMAGE_MAX_FILES} imagens no texto.`;
  }
  return null;
}

/** Imagem colada costuma vir como `image.png`, mas pode vir sem extensão: o tipo decide. */
export function withExtension(file: File): File {
  if (/\.[a-z0-9]+$/i.test(file.name)) return file;
  const subtype = file.type.split('/')[1] ?? 'png';
  return new File([file], `imagem.${subtype === 'jpeg' ? 'jpg' : subtype}`, { type: file.type });
}

/** O que vai junto da mensagem: as chaves (no JSON) e os arquivos (campo `inline`), na mesma ordem. */
export interface InlineUpload {
  inlineImages: string[];
  inline: File[];
}

/**
 * Imagens inseridas no editor e ainda não enviadas (T32 RN-25). Cada uma tem uma chave e uma
 * URL `blob:` para a prévia; o arquivo só sobe no envio.
 */
export interface InlineImageStore {
  add(file: File): { key: string; url: string };
  /** As imagens que o HTML ainda referencia (as apagadas do texto ficam de fora, RN-08). */
  collect(html: string): InlineUpload;
  /** Depois do envio: esquece as imagens e libera as prévias. */
  clear(): void;
}

export function createInlineImageStore(): InlineImageStore {
  const images = new Map<string, { file: File; url: string }>();
  return {
    add(file) {
      const key = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      images.set(key, { file, url });
      return { key, url };
    },
    collect(html) {
      const inlineImages = inlineKeysIn(html).filter((key) => images.has(key));
      return { inlineImages, inline: inlineImages.map((key) => images.get(key)!.file) };
    },
    clear() {
      for (const { url } of images.values()) URL.revokeObjectURL(url);
      images.clear();
    },
  };
}

/** Uma store por formulário, liberada ao desmontar. */
export function useInlineImages(): InlineImageStore {
  const [store] = useState(createInlineImageStore);
  useEffect(() => () => store.clear(), [store]);
  return store;
}

/** Junta as imagens ao JSON da mensagem só quando há alguma (o schema é estrito). */
export function withInlineImages<T extends object>(
  data: T,
  upload: InlineUpload,
): T & { inlineImages?: string[] } {
  return upload.inlineImages.length > 0 ? { ...data, inlineImages: upload.inlineImages } : data;
}
