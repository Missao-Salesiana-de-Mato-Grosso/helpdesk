import { sanitizeFilename } from './filename.js';

describe('sanitizeFilename', () => {
  it('remove caminho, caracteres de controle e aspas', () => {
    expect(sanitizeFilename('C:\\Users\\maria\\print.png')).toBe('print.png');
    expect(sanitizeFilename('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('a\u0000b"c\nd.pdf')).toBe('abcd.pdf');
  });

  it('mantém acentos e normaliza espaços', () => {
    expect(sanitizeFilename('  relatório   final.pdf ')).toBe('relatório final.pdf');
  });

  it('vazio ou só pontos vira "arquivo"', () => {
    expect(sanitizeFilename('')).toBe('arquivo');
    expect(sanitizeFilename('..')).toBe('arquivo');
    expect(sanitizeFilename('dir/')).toBe('arquivo');
  });

  it('corta em 255 caracteres preservando a extensão', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.xlsx`);
    expect(name).toHaveLength(255);
    expect(name.endsWith('.xlsx')).toBe(true);
  });
});
