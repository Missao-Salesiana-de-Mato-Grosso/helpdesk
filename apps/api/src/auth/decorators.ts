import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';
import type { Role } from '@helpdesk/shared';
import type { AuthenticatedRequest, CurrentUser as CurrentUserType } from './current-user.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const ALLOW_DURING_ONBOARDING_KEY = 'auth:allowDuringOnboarding';
export const ALLOW_WHILE_PENDING_KEY = 'auth:allowWhilePending';

/** Dispensa o token. Sem este decorator, toda rota é autenticada (RN-01). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige ao menos uma das roles (RN-07). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Rota acessível antes de o usuário informar unidade e departamento (RN-14). */
export const AllowDuringOnboarding = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DURING_ONBOARDING_KEY, true);

/** Rota acessível com acesso `pending`, `rejected` ou `trashed` (T22, RN-06). */
export const AllowWhilePending = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WHILE_PENDING_KEY, true);

/** Injeta o `CurrentUser` montado pelo guard. Não use em rotas `@Public()`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserType => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      throw new InternalServerErrorException('@CurrentUser() usado numa rota sem autenticação');
    }
    return user;
  },
);
