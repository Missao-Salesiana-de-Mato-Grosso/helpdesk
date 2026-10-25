import { describe, expect, it } from 'vitest';
import { addFiles, formatSize, requestBody } from './attachments.ts';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('anexos no front (T13)', () => {
  it('aceita tipos da lista e recusa os outros, com o motivo', () => {
    const { files, errors } = addFiles(
      [],
      [file('print.png'), file('virus.exe'), file('pagina.html')],
    );
    expect(files.map((f) => f.name)).toEqual(['print.png']);
    expect(errors).toEqual([
      'virus.exe: tipo de arquivo não aceito.',
      'pagina.html: tipo de arquivo não aceito.',
    ]);
  });

  it('recusa arquivo acima de 20 MB e o 6º arquivo', () => {
    const big = addFiles([], [file('grande.pdf', 20 * 1024 * 1024 + 1)]);
    expect(big.files).toEqual([]);
    expect(big.errors).toEqual(['grande.pdf: passa de 20 MB.']);
    const five = Array.from({ length: 5 }, (_, i) => file(`f${i}.pdf`));
    const sixth = addFiles(five, [file('f5.pdf')]);
    expect(sixth.files).toHaveLength(5);
    expect(sixth.errors).toEqual(['f5.pdf: no máximo 5 arquivos por mensagem.']);
  });

  it('sem arquivos o corpo é JSON; com arquivos, multipart com data e files', () => {
    expect(requestBody({ a: 1 }, [])).toBe('{"a":1}');
    const form = requestBody({ a: 1 }, [file('a.pdf'), file('b.png')]);
    expect(form).toBeInstanceOf(FormData);
    const data = form instanceof FormData ? form : new FormData();
    expect(data.get('data')).toBe('{"a":1}');
    expect(data.getAll('files').map((f) => (f instanceof File ? f.name : ''))).toEqual([
      'a.pdf',
      'b.png',
    ]);
  });

  it('formata tamanhos', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
