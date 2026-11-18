import { describe, expect, it, vi } from 'vitest';
import {
  createInlineImageStore,
  inlineImageError,
  inlineKeysIn,
  withExtension,
  withInlineImages,
} from './inline-images.ts';

const png = (name = 'a.png') => new File(['x'], name, { type: 'image/png' });

describe('imagens no texto (spec T32)', () => {
  it('CT-22 recusa a 11ª imagem', () => {
    expect(inlineImageError(png(), 9)).toBeNull();
    expect(inlineImageError(png(), 10)).toBe('No máximo 10 imagens no texto.');
  });

  it('imagem colada sem extensão ganha a do tipo', () => {
    const file = withExtension(new File(['x'], 'image', { type: 'image/jpeg' }));
    expect(file.name).toBe('imagem.jpg');
    expect(withExtension(png('print.png')).name).toBe('print.png');
  });

  it('CT-21 collect: só as chaves ainda no texto, na ordem e sem repetir', () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: revoke }),
    );
    const store = createInlineImageStore();
    const a = store.add(png('a.png'));
    const b = store.add(png('b.png'));
    store.add(png('apagada.png'));
    const html = `<p><img data-inline-key="${b.key}"> <img src="blob:x" data-inline-key="${a.key}"><img data-inline-key="${b.key}"><img data-inline-key="desconhecida"></p>`;
    expect(inlineKeysIn(html)).toEqual([b.key, a.key, 'desconhecida']);
    const upload = store.collect(html);
    expect(upload.inlineImages).toEqual([b.key, a.key]);
    expect(upload.inline.map((file) => file.name)).toEqual(['b.png', 'a.png']);

    store.clear();
    expect(revoke).toHaveBeenCalledTimes(3);
    expect(store.collect(html).inlineImages).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('withInlineImages só acrescenta o campo quando há imagem', () => {
    const data = { kind: 'public', bodyHtml: '<p>x</p>' };
    expect(withInlineImages(data, { inlineImages: [], inline: [] })).toEqual(data);
    expect(withInlineImages(data, { inlineImages: ['k'], inline: [png()] })).toEqual({
      ...data,
      inlineImages: ['k'],
    });
  });
});
