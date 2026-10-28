import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

export interface SecurityOptions {
  /** Origem do Zitadel: o front chama discovery, token e userinfo direto nele (OIDC). */
  zitadelIssuer: string;
  production: boolean;
}

/**
 * CSP do portal (T18). Em produção a API serve o `index.html` (T17), então esta política vale para o
 * front inteiro. Chamar antes de `serveSpa`, para que o estático também receba os headers.
 * - `style-src 'unsafe-inline'`: o Mantine injeta `<style>` e atributos `style` em tempo de execução.
 * - `img-src https:`: o HTML sanitizado aceita `<img src="https://…">` (e-mails de entrada).
 * - `frame-src` no Zitadel: renovação silenciosa por iframe, se o refresh token faltar.
 */
export function contentSecurityPolicy({
  zitadelIssuer,
  production,
}: SecurityOptions): Record<string, string[] | null> {
  const issuer = new URL(zitadelIssuer).origin;
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", issuer],
    'frame-src': [issuer],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    // Fora de produção o Zitadel local é http: o upgrade quebraria o login.
    'upgrade-insecure-requests': production ? [] : null,
  };
}

/** helmet com a CSP do portal. Usado por `main.ts` e pelos testes e2e. */
export function applySecurityHeaders(app: INestApplication, options: SecurityOptions): void {
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: contentSecurityPolicy(options) },
    }),
  );
}
