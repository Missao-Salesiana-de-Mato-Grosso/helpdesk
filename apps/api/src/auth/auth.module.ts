import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { CompaniesModule } from '../companies/companies.module.js';
import type { Env } from '../config/env.js';
import { DepartmentsModule } from '../departments/departments.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthGuard } from './auth.guard.js';
import { JWKS_PROVIDER, USERINFO_CLIENT } from './auth.tokens.js';
import { JitService } from './jit.service.js';
import { MeController } from './me.controller.js';
import { TokenVerifierService } from './token-verifier.service.js';
import { UserCache } from './user-cache.js';
import { HttpUserinfoClient } from './userinfo.client.js';

@Module({
  imports: [UsersModule, CompaniesModule, DepartmentsModule],
  controllers: [MeController],
  providers: [
    {
      provide: JWKS_PROVIDER,
      inject: [ConfigService],
      // cacheMaxAge infinito: com o Zitadel fora do ar, as chaves em cache continuam valendo (RN-04).
      // Rotação de chave chega pelo `kid` desconhecido, que força um novo fetch.
      useFactory: (config: ConfigService<Env, true>) =>
        createRemoteJWKSet(
          new URL(`${config.get('ZITADEL_ISSUER', { infer: true })}/oauth/v2/keys`),
          {
            cacheMaxAge: Number.POSITIVE_INFINITY,
          },
        ),
    },
    {
      provide: USERINFO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new HttpUserinfoClient(config.get('ZITADEL_ISSUER', { infer: true })),
    },
    TokenVerifierService,
    UserCache,
    JitService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [UserCache],
})
export class AuthModule {}
