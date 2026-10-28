import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { applySecurityHeaders } from './common/security.js';
import { serveSpa } from './common/spa.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api');
  // Um proxy na frente (Traefik). Ver common/client-ip.ts.
  app.set('trust proxy', 1);
  applySecurityHeaders(app, {
    zitadelIssuer: config.get('ZITADEL_ISSUER', { infer: true }),
    production: config.get('NODE_ENV', { infer: true }) === 'production',
  });
  // Produção (imagem Docker): a API também serve o build do front. Em dev, o Vite serve o front.
  const webDist = process.env.WEB_DIST_PATH;
  if (webDist) serveSpa(app, webDist);
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
