import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  // Um proxy na frente (Traefik). Ver common/client-ip.ts.
  app.set('trust proxy', 1);
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
