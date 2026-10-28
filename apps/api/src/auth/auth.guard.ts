import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiErrorCode, type Role } from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import type { AuthenticatedRequest, CurrentUser } from './current-user.js';
import {
  ALLOW_DURING_ONBOARDING_KEY,
  ALLOW_WHILE_PENDING_KEY,
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from './decorators.js';
import { JitService } from './jit.service.js';
import { TokenVerifierService } from './token-verifier.service.js';

const AGENT_ROLES: readonly Role[] = ['agente', 'supervisor', 'admin'];
const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

/**
 * Guard global (RN-01). Ordem: @Public → token (401/503) → organização (403) → JIT →
 * usuário ativo (403) → onboarding (403) → liberação de acesso (403, T22) → @Roles (403).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifierService,
    private readonly jit: JitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = BEARER.exec(request.headers.authorization ?? '');
    if (!match) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ApiErrorCode.AUTH_MISSING,
        'Autenticação necessária.',
      );
    }
    const accessToken = match[1]!;

    const { sub, roles } = await this.verifier.verify(accessToken);
    const local = await this.jit.resolve(sub, roles, accessToken);

    if (!local.active) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.USER_INACTIVE,
        'Usuário desativado. Procure o suporte.',
      );
    }

    const user: CurrentUser = {
      id: local.id,
      zitadelSub: local.zitadelSub,
      email: local.email,
      name: local.name,
      roles,
      isAgent: roles.some((role) => AGENT_ROLES.includes(role)),
      companyId: local.companyId,
      departmentId: local.departmentId,
      groupIds: local.groupIds,
      needsOnboarding: local.companyId === null || local.departmentId === null,
      accessStatus: local.accessStatus,
    };
    request.user = user;

    if (
      user.needsOnboarding &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_ONBOARDING_KEY, targets)
    ) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.ONBOARDING_REQUIRED,
        'Informe unidade e departamento para continuar.',
      );
    }

    // T22 RN-06/RN-07: pending, rejected ou trashed não acessam nada além do que opta explicitamente.
    if (
      user.accessStatus !== 'approved' &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_PENDING_KEY, targets)
    ) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        user.accessStatus === 'rejected'
          ? ApiErrorCode.ACCESS_REJECTED
          : ApiErrorCode.ACCESS_PENDING,
        user.accessStatus === 'rejected'
          ? 'Seu acesso ao help desk não foi liberado.'
          : 'Seu acesso ao help desk ainda não foi liberado.',
      );
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (required?.length && !required.some((role) => roles.includes(role))) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.FORBIDDEN_ROLE,
        'Você não tem permissão para esta ação.',
      );
    }
    return true;
  }
}
