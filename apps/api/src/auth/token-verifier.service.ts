import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiErrorCode, ROLES, type Role } from '@helpdesk/shared';
import { errors, jwtVerify, type JWTPayload } from 'jose';
import { ApiException } from '../common/api-exception.js';
import type { Env } from '../config/env.js';
import { JWKS_PROVIDER, type JwksProvider } from './auth.tokens.js';

const RESOURCE_OWNER_CLAIM = 'urn:zitadel:iam:user:resourceowner:id';
const GENERIC_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles';

// Falhas do próprio token: 401. Qualquer outra (rede, timeout, JWKS ilegível) é indisponibilidade: 503.
const INVALID_TOKEN_CODES = new Set<string>([
  errors.JWTExpired.code,
  errors.JWTClaimValidationFailed.code,
  errors.JWTInvalid.code,
  errors.JWSInvalid.code,
  errors.JWSSignatureVerificationFailed.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWKInvalid.code,
]);

export interface VerifiedToken {
  sub: string;
  roles: Role[];
}

export const authInvalid = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    ApiErrorCode.AUTH_INVALID,
    'Token inválido ou expirado.',
  );

export const authUnavailable = (): ApiException =>
  new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    ApiErrorCode.AUTH_UNAVAILABLE,
    'Autenticação temporariamente indisponível.',
  );

/** RN-05: chaves do claim de roles (objeto, ou array de objetos), filtradas pelas roles conhecidas. */
export function extractRoles(payload: JWTPayload, projectId: string): Role[] {
  const claim =
    payload[`urn:zitadel:iam:org:project:${projectId}:roles`] ?? payload[GENERIC_ROLES_CLAIM];
  const objects = Array.isArray(claim) ? claim : [claim];
  const keys = new Set<string>();
  for (const value of objects) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value)) keys.add(key);
    }
  }
  return ROLES.filter((role) => keys.has(role));
}

/** RN-03 a RN-06: valida o JWT localmente contra o JWKS do Zitadel e extrai `sub` e roles. */
@Injectable()
export class TokenVerifierService {
  private readonly logger = new Logger(TokenVerifierService.name);
  private readonly issuer: string;
  private readonly projectId: string;
  private readonly orgId: string | undefined;
  private readonly clockTolerance: number;

  constructor(
    @Inject(JWKS_PROVIDER) private readonly jwks: JwksProvider,
    config: ConfigService<Env, true>,
  ) {
    this.issuer = config.get('ZITADEL_ISSUER', { infer: true });
    this.projectId = config.get('ZITADEL_PROJECT_ID', { infer: true });
    this.orgId = config.get('ZITADEL_ORG_ID', { infer: true });
    this.clockTolerance = config.get('AUTH_CLOCK_TOLERANCE_SECONDS', { infer: true });
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.projectId,
        clockTolerance: this.clockTolerance,
        requiredClaims: ['sub', 'exp'],
      }));
    } catch (error) {
      if (error instanceof errors.JOSEError && INVALID_TOKEN_CODES.has(error.code)) {
        this.logger.debug(`Token rejeitado: ${error.code}`);
        throw authInvalid();
      }
      this.logger.warn(`JWKS indisponível: ${error instanceof Error ? error.message : 'erro'}`);
      throw authUnavailable();
    }

    // jose só confere `iat` com maxTokenAge; aqui basta que não esteja no futuro (RN-03).
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.iat === 'number' && payload.iat > now + this.clockTolerance) {
      this.logger.debug('Token rejeitado: iat no futuro');
      throw authInvalid();
    }

    if (this.orgId && payload[RESOURCE_OWNER_CLAIM] !== this.orgId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.WRONG_ORGANIZATION,
        'Esta conta não pertence à organização do Help Desk.',
      );
    }

    // `sub` é garantido por requiredClaims; a checagem só estreita o tipo.
    if (!payload.sub) throw authInvalid();
    return { sub: payload.sub, roles: extractRoles(payload, this.projectId) };
  }
}
