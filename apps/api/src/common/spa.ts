import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Em produção a API serve o build do front (T17: um único deploy, sem proxy).
 * - `/assets/*` têm hash no nome: cache longo e imutável.
 * - Qualquer outro GET fora de `/api` devolve o `index.html` (rotas do React Router), sem cache,
 *   para que um deploy novo chegue ao navegador no próximo carregamento.
 * Chamar antes de `listen`: os middlewares ficam antes das rotas do Nest, que só atendem `/api`.
 */
export function serveSpa(app: NestExpressApplication, webDist: string): void {
  const indexHtml = join(webDist, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`WEB_DIST_PATH=${webDist} não contém index.html`);
  }
  const assetsDir = join(webDist, 'assets') + sep;
  app.useStaticAssets(webDist, {
    index: false,
    setHeaders: (response, path) => {
      response.setHeader(
        'Cache-Control',
        path.startsWith(assetsDir) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const isApi = request.path === '/api' || request.path.startsWith('/api/');
    if ((request.method !== 'GET' && request.method !== 'HEAD') || isApi) {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexHtml);
  });
}
