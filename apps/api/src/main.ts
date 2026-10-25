import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { serveSpa } from './common/spa.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  // Um proxy na frente (Traefik). Ver common/client-ip.ts.
  app.set('trust proxy', 1);
  // Produção (imagem Docker): a API também serve o build do front. Em dev, o Vite serve o front.
  const webDist = process.env.WEB_DIST_PATH;
  if (webDist) serveSpa(app, webDist);
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
