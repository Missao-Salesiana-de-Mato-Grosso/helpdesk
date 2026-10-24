import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * IP do cliente para `ticket_events.ip` (RN-40 da spec T08–T10): o primeiro valor de
 * `X-Forwarded-For` (o Traefik o preenche), senão o IP do socket. Valor inválido → null.
 */
export function clientIp(request: Request): string | null {
  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
  const candidate = (forwarded || request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return isIP(candidate) ? candidate : null;
}
