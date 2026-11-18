import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ACCEPT, attachmentMimeType, inlineImageMimeType } from './attachments.js';

describe('attachmentMimeType', () => {
  it('usa a extensão, sem diferenciar maiúsculas', () => {
    expect(attachmentMimeType('Relatório.PDF')).toBe('application/pdf');
    expect(attachmentMimeType('print.jpeg')).toBe('image/jpeg');
    expect(attachmentMimeType('mensagem.eml')).toBe('message/rfc822');
  });

  it('recusa extensões fora da lista e nomes sem extensão', () => {
    expect(attachmentMimeType('pagina.html')).toBeNull();
    expect(attachmentMimeType('script.exe')).toBeNull();
    expect(attachmentMimeType('imagem.svg')).toBeNull();
    expect(attachmentMimeType('LEIAME')).toBeNull();
    expect(attachmentMimeType('constructor')).toBeNull();
    expect(attachmentMimeType('x.constructor')).toBeNull();
  });

  it('monta o accept do input de arquivo', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toContain('.xlsx');
  });
});

describe('inlineImageMimeType (spec T32 RN-03)', () => {
  it('aceita só as imagens', () => {
    expect(inlineImageMimeType('print.PNG')).toBe('image/png');
    expect(inlineImageMimeType('foto.jpeg')).toBe('image/jpeg');
    expect(inlineImageMimeType('anim.gif')).toBe('image/gif');
    expect(inlineImageMimeType('x.webp')).toBe('image/webp');
    expect(inlineImageMimeType('doc.pdf')).toBeNull();
    expect(inlineImageMimeType('imagem.svg')).toBeNull();
    expect(inlineImageMimeType('png')).toBeNull();
  });
});
