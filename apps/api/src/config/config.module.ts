import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { validateEnv } from './env.js';

// O .env fica na raiz do monorepo (mesma profundidade a partir de src/ e de dist/).
// Em produção não existe arquivo: as variáveis vêm do ambiente (Kubernetes Secrets).
const rootEnvFile = fileURLToPath(new URL('../../../../.env', import.meta.url));

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [rootEnvFile],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
