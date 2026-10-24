import type { JWTVerifyGetKey } from 'jose';

/** Fonte das chaves públicas do Zitadel. Nos testes, substituída por um JWKS local (RN-16). */
export const JWKS_PROVIDER = Symbol('JWKS_PROVIDER');
export type JwksProvider = JWTVerifyGetKey;

/** Cliente do endpoint `userinfo`. Nos testes, substituído por um falso (RN-16). */
export const USERINFO_CLIENT = Symbol('USERINFO_CLIENT');

export interface UserinfoProfile {
  email: string;
  name: string;
  /** Claim `email_verified`. Sem ele, vale `false`. */
  emailVerified: boolean;
}

export interface UserinfoClient {
  /** Lança `UserinfoUnavailableError` em qualquer falha (rede, status ≠ 200, sem e-mail). */
  fetchProfile(accessToken: string): Promise<UserinfoProfile>;
}

export class UserinfoUnavailableError extends Error {
  override name = 'UserinfoUnavailableError';
}
