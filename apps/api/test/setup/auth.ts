// Autenticação nos testes sem Zitadel (RN-16): par de chaves RSA em memória, JWKS local e userinfo falso.
import type { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { App } from 'supertest/types.js';
import type { Mock } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  JWKS_PROVIDER,
  USERINFO_CLIENT,
  type UserinfoProfile,
} from '../../src/auth/auth.tokens.js';
import { TokenVerifierService } from '../../src/auth/token-verifier.service.js';
import { UserCache } from '../../src/auth/user-cache.js';
import type { Env } from '../../src/config/env.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export const TEST_ISSUER = 'http://zitadel.test';
export const TEST_PROJECT_ID = 'test-project';
export const ROLES_CLAIM = `urn:zitadel:iam:org:project:${TEST_PROJECT_ID}:roles`;
export const RESOURCE_OWNER_CLAIM = 'urn:zitadel:iam:user:resourceowner:id';

export interface TokenOptions {
  sub?: string;
  /** Roles no formato do Zitadel: `{ agente: { <orgId>: <domain> } }`. Atalho: lista de nomes. */
  roles?: string[];
  claims?: JWTPayload;
  iss?: string;
  aud?: string | string[];
  /** Segundos a partir de agora (negativo = já expirado). Padrão: 3600. */
  expiresIn?: number;
  /** Assina com outra chave (não publicada no JWKS). */
  key?: CryptoKey;
}

/** Assina access tokens como o Zitadel, com claims configuráveis. */
export class TestTokenFactory {
  private constructor(
    private readonly privateKey: CryptoKey,
    readonly jwks: JWTVerifyGetKey,
  ) {}

  static async create(): Promise<TestTokenFactory> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
    return new TestTokenFactory(privateKey, createLocalJWKSet({ keys: [jwk] }));
  }

  /** Uma chave que não está no JWKS (CT-03). */
  static async foreignKey(): Promise<CryptoKey> {
    return (await generateKeyPair('RS256')).privateKey;
  }

  sign(options: TokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = { ...options.claims };
    if (options.roles) {
      payload[ROLES_CLAIM] = Object.fromEntries(
        options.roles.map((role) => [role, { 'org-1': 'missaosalesiana.org.br' }]),
      );
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.iss ?? TEST_ISSUER)
      .setAudience(options.aud ?? [TEST_PROJECT_ID, 'client-id'])
      .setSubject(options.sub ?? 'sub-1')
      .setIssuedAt(now - 10)
      .setExpirationTime(now + (options.expiresIn ?? 3600))
      .sign(options.key ?? this.privateKey);
  }
}

export interface FakeUserinfo {
  fetchProfile: Mock<(accessToken: string) => Promise<UserinfoProfile>>;
}

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  cache: UserCache;
  tokens: TestTokenFactory;
  userinfo: FakeUserinfo;
  /** Troca a fonte do JWKS em tempo de execução (CT-09). */
  setJwks(jwks: JWTVerifyGetKey): void;
}

export interface TestAppOptions {
  /** Controllers extras, só para os testes (ex.: rotas com @Roles). */
  controllers?: Type[];
  /** Sobrescreve variáveis lidas pelo TokenVerifierService (ex.: ZITADEL_ORG_ID). */
  env?: Partial<Env>;
}

/** Sobe a aplicação inteira com JWKS local e userinfo falso. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const tokens = await TestTokenFactory.create();
  let jwks: JWTVerifyGetKey = tokens.jwks;
  const userinfo: FakeUserinfo = { fetchProfile: vi.fn() };

  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(JWKS_PROVIDER)
    .useValue(((header, token) => jwks(header, token)) satisfies JWTVerifyGetKey)
    .overrideProvider(USERINFO_CLIENT)
    .useValue(userinfo);

  if (options.env) {
    const overrides = options.env;
    builder.overrideProvider(TokenVerifierService).useFactory({
      inject: [JWKS_PROVIDER, ConfigService],
      factory: (provider: JWTVerifyGetKey, config: ConfigService<Env, true>) =>
        new TokenVerifierService(
          provider,
          // Dublê parcial: o TokenVerifierService só usa `get`.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          {
            get: (key: keyof Env) => (key in overrides ? overrides[key] : config.get(key)),
          } as ConfigService<Env, true>,
        ),
    });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api');
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    cache: app.get(UserCache),
    tokens,
    userinfo,
    setJwks: (next) => {
      jwks = next;
    },
  };
}
