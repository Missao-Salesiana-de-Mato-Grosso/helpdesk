import { z } from 'zod';

// T31: assinatura de e-mail do agente, acrescentada ao `reply` no envio.

/** Limite do HTML bruto, antes da sanitização (RN-03). */
export const MAX_SIGNATURE_HTML_LENGTH = 2000;

/** Corpo de `PUT /api/me/signature`. Vazio apaga a assinatura (RN-05). */
export const updateSignatureSchema = z
  .object({
    signatureHtml: z
      .string()
      .max(
        MAX_SIGNATURE_HTML_LENGTH,
        `A assinatura passa do limite de ${MAX_SIGNATURE_HTML_LENGTH} caracteres`,
      ),
  })
  .strict();

export type UpdateSignatureInput = z.infer<typeof updateSignatureSchema>;

/** Resposta de `GET` e `PUT /api/me/signature`: o HTML gravado, já sanitizado. */
export interface SignatureResponse {
  signatureHtml: string | null;
}
