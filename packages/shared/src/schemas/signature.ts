import { z } from 'zod';
import { INLINE_IMAGE_KEY, SIGNATURE_IMAGE_MAX_FILES } from '../attachments.js';

// T31: assinatura de e-mail do agente, acrescentada ao `reply` no envio.

/** Limite do HTML bruto, antes da sanitização (RN-03). */
export const MAX_SIGNATURE_HTML_LENGTH = 2000;

/**
 * Corpo de `PUT /api/me/signature`. Vazio apaga a assinatura (RN-05). T33: `inlineImages` são as
 * chaves das imagens novas (`<img data-inline-key>`), na ordem dos arquivos do campo `inline`.
 */
export const updateSignatureSchema = z
  .object({
    signatureHtml: z
      .string()
      .max(
        MAX_SIGNATURE_HTML_LENGTH,
        `A assinatura passa do limite de ${MAX_SIGNATURE_HTML_LENGTH} caracteres`,
      ),
    inlineImages: z
      .array(z.string().regex(INLINE_IMAGE_KEY, 'Chave de imagem inválida'))
      .max(
        SIGNATURE_IMAGE_MAX_FILES,
        `A assinatura pode ter no máximo ${SIGNATURE_IMAGE_MAX_FILES} imagens`,
      )
      .refine((keys) => new Set(keys).size === keys.length, 'Chave de imagem repetida')
      .optional(),
  })
  .strict();

export type UpdateSignatureInput = z.infer<typeof updateSignatureSchema>;

/** Resposta de `GET` e `PUT /api/me/signature`: o HTML gravado, já sanitizado. */
export interface SignatureResponse {
  signatureHtml: string | null;
}
