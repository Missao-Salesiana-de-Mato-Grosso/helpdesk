import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Env } from '../config/env.js';

/**
 * Nunca logar tokens, `Authorization`, cookies nem corpo de mensagem ou de e-mail (CLAUDE.md, T18).
 * O serializer de `req` já não leva headers nem corpo; a lista abaixo é a segunda barreira, para
 * objetos passados ao logger por engano.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'res.headers["set-cookie"]',
  'authorization',
  'body',
  'bodyHtml',
  'quotedHtml',
  'html',
  'text',
  'password',
  'token',
  'accessToken',
  '*.authorization',
  '*.body',
  '*.bodyHtml',
  '*.quotedHtml',
  '*.html',
  '*.text',
  '*.password',
  '*.token',
  '*.accessToken',
];

const isHealthCheck = (request: IncomingMessage) => request.url?.startsWith('/api/health') ?? false;

/** Parâmetros do `nestjs-pino`. `destination` só nos testes, para capturar a saída. */
export function loggerParams(env: Pick<Env, 'LOG_LEVEL'>, destination?: DestinationStream): Params {
  const options = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    // As probes do Kubernetes batem no health a cada poucos segundos.
    autoLogging: { ignore: isHealthCheck },
    serializers: {
      req: (request: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
        id: request.id,
        method: request.method,
        url: request.url,
        remoteAddress: request.remoteAddress,
      }),
      res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
    },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
