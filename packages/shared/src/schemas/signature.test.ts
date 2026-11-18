import { describe, expect, it } from 'vitest';
import { MAX_SIGNATURE_HTML_LENGTH, updateSignatureSchema } from './signature.js';

describe('updateSignatureSchema (spec T31)', () => {
  it('CT-18 accepts the limit and an empty signature, rejects the rest', () => {
    const atLimit = 'a'.repeat(MAX_SIGNATURE_HTML_LENGTH);
    expect(updateSignatureSchema.safeParse({ signatureHtml: atLimit }).success).toBe(true);
    expect(updateSignatureSchema.safeParse({ signatureHtml: '' }).success).toBe(true);

    expect(updateSignatureSchema.safeParse({ signatureHtml: `${atLimit}a` }).success).toBe(false);
    expect(updateSignatureSchema.safeParse({}).success).toBe(false);
    expect(updateSignatureSchema.safeParse({ signatureHtml: null }).success).toBe(false);
    expect(updateSignatureSchema.safeParse({ signatureHtml: '<p>x</p>', name: 'x' }).success).toBe(
      false,
    );
  });
});

const parse = (inlineImages: unknown) =>
  updateSignatureSchema.safeParse({ signatureHtml: '<p>x</p>', inlineImages }).success;

describe('inlineImages na assinatura (spec T33)', () => {
  it('CT-13 aceita até 2 chaves válidas e sem repetir', () => {
    expect(parse(['a', 'b'])).toBe(true);
    expect(parse(['a', 'b', 'c'])).toBe(false);
    expect(parse(['a', 'a'])).toBe(false);
    expect(parse(['a b'])).toBe(false);
  });
});
