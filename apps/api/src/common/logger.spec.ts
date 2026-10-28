import { Writable } from 'node:stream';
import { pino, type LoggerOptions } from 'pino';
import { loggerParams } from './logger.js';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const { pinoHttp } = loggerParams({ LOG_LEVEL: 'info' }, destination);
  if (!Array.isArray(pinoHttp)) throw new Error('esperava [options, destination]');
  // As opções do pino-http incluem as do pino (level, redact, serializers).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const logger = pino(pinoHttp[0] as LoggerOptions, pinoHttp[1]);
  return { logger, output: () => lines.join('') };
}

describe('loggerParams', () => {
  it('redacts message bodies and tokens passed to the logger by mistake', () => {
    const { logger, output } = capture();
    logger.info(
      {
        bodyHtml: '<p>corpo-1</p>',
        message: { bodyHtml: '<p>corpo-2</p>', quotedHtml: '<p>citado</p>', text: 'texto-email' },
        email: { html: '<p>html-email</p>', subject: 'Assunto visível' },
        headers: { authorization: 'Bearer abc.def' },
        token: 'tok-1',
      },
      'teste',
    );
    const line = output();
    for (const secret of [
      'corpo-1',
      'corpo-2',
      'citado',
      'texto-email',
      'html-email',
      'abc.def',
      'tok-1',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[redacted]');
    expect(line).toContain('Assunto visível');
  });

  it('serializes a request without headers or body', () => {
    const { logger, output } = capture();
    logger.info({
      req: {
        id: 1,
        method: 'POST',
        url: '/api/tickets',
        headers: { authorization: 'Bearer abc.def', cookie: 'c=1' },
        body: { bodyHtml: 'corpo' },
      },
    });
    const line = output();
    expect(line).toContain('"url":"/api/tickets"');
    expect(line).not.toContain('abc.def');
    expect(line).not.toContain('corpo');
    expect(line).not.toContain('cookie');
  });
});
