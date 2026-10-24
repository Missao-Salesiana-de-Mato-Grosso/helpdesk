import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ApiErrorCode, type Role } from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { UsersService, type UserWithGroupIds } from '../users/users.service.js';
import { USERINFO_CLIENT, type UserinfoClient, type UserinfoProfile } from './auth.tokens.js';
import { authUnavailable } from './token-verifier.service.js';
import { UserCache } from './user-cache.js';

const HOUR_MS = 60 * 60 * 1000;
const LAST_LOGIN_REFRESH_MS = HOUR_MS;
const PROFILE_SYNC_MS = 24 * HOUR_MS;

/** O que fica em cache por `sub`. As roles vêm sempre do token da requisição. */
export interface CachedUser {
  id: string;
  zitadelSub: string;
  email: string;
  name: string;
  active: boolean;
  companyId: string | null;
  departmentId: string | null;
  groupIds: string[];
}

const sameRoles = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.toSorted().join() === b.toSorted().join();

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Provisionamento JIT do usuário local a partir do token (RN-09 a RN-11). */
@Injectable()
export class JitService {
  private readonly logger = new Logger(JitService.name);

  constructor(
    private readonly users: UsersService,
    private readonly cache: UserCache,
    @Inject(USERINFO_CLIENT) private readonly userinfo: UserinfoClient,
  ) {}

  async resolve(sub: string, roles: Role[], accessToken: string): Promise<CachedUser> {
    const cached = this.cache.get(sub);
    if (cached) return cached;

    const existing = await this.users.findBySub(sub);
    const user = existing
      ? await this.refresh(existing, roles, accessToken)
      : await this.provision(sub, roles, accessToken);

    const value: CachedUser = {
      id: user.id,
      zitadelSub: sub,
      email: user.email,
      name: user.name,
      active: user.active,
      companyId: user.companyId,
      departmentId: user.departmentId,
      groupIds: user.groupMemberships.map((m) => m.groupId),
    };
    this.cache.set(sub, value);
    return value;
  }

  /** RN-10: 1º login deste `sub`. */
  private async provision(
    sub: string,
    roles: Role[],
    accessToken: string,
  ): Promise<UserWithGroupIds> {
    let profile: UserinfoProfile;
    try {
      profile = await this.userinfo.fetchProfile(accessToken);
    } catch (error) {
      this.logger.warn(`userinfo falhou no 1º acesso: ${errorMessage(error)}`);
      throw authUnavailable();
    }

    const now = new Date();
    const data = { zitadelSub: sub, email: profile.email, name: profile.name, roles };
    const byEmail = await this.users.findByEmail(profile.email);

    if (byEmail?.isExternal) {
      this.logger.warn(`Login de usuário marcado como terceiro bloqueado (user ${byEmail.id})`);
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.EXTERNAL_USER_CANNOT_LOGIN,
        'Este e-mail está cadastrado como terceiro e não pode acessar o portal. Procure o suporte.',
      );
    }
    if (byEmail?.zitadelSub) {
      this.logger.error(
        `E-mail já vinculado a outro sub do Zitadel (user ${byEmail.id}); conta duplicada no Zitadel?`,
      );
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.WRONG_ORGANIZATION,
        'Esta conta não corresponde ao usuário cadastrado. Procure o suporte.',
      );
    }
    if (byEmail && !profile.emailVerified) {
      // Vincular por e-mail não verificado entregaria os tickets de outra pessoa a quem cadastrou o e-mail.
      this.logger.warn(
        `Vínculo por e-mail recusado: e-mail não verificado no Zitadel (user ${byEmail.id})`,
      );
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.EMAIL_NOT_VERIFIED,
        'Seu e-mail ainda não foi verificado. Verifique-o e entre de novo.',
      );
    }
    if (byEmail) {
      this.logger.log(
        `Usuário criado pelo canal de e-mail vinculado ao login (user ${byEmail.id})`,
      );
      return this.users.linkToLogin(byEmail.id, data, now);
    }

    try {
      return await this.users.createFromLogin(data, now);
    } catch (error) {
      // Duas requisições simultâneas do 1º acesso: a outra criou primeiro.
      if (isUniqueViolation(error)) {
        const created = await this.users.findBySub(sub);
        if (created) return created;
      }
      throw error;
    }
  }

  /** RN-11: usuário já conhecido; sincroniza roles, último login e perfil. */
  private async refresh(
    user: UserWithGroupIds,
    roles: Role[],
    accessToken: string,
  ): Promise<UserWithGroupIds> {
    const now = new Date();
    const updates: Parameters<UsersService['updateLoginState']>[1] = {};

    if (!sameRoles(user.roles, roles)) updates.roles = roles;
    if (!user.lastLoginAt || now.getTime() - user.lastLoginAt.getTime() > LAST_LOGIN_REFRESH_MS) {
      updates.lastLoginAt = now;
    }
    if (!user.profileSyncedAt || now.getTime() - user.profileSyncedAt.getTime() > PROFILE_SYNC_MS) {
      try {
        const profile = await this.userinfo.fetchProfile(accessToken);
        updates.profileSyncedAt = now;
        if (profile.name !== user.name) updates.name = profile.name;
        if (profile.emailVerified && profile.email.toLowerCase() !== user.email.toLowerCase()) {
          const other = await this.users.findByEmail(profile.email);
          if (other && other.id !== user.id) {
            this.logger.warn(
              `Novo e-mail do Zitadel colide com outro usuário (user ${user.id}); mantido o antigo`,
            );
          } else {
            updates.email = profile.email;
          }
        }
      } catch (error) {
        this.logger.warn(
          `Resincronização de perfil falhou (user ${user.id}): ${errorMessage(error)}`,
        );
      }
    }

    return Object.keys(updates).length > 0 ? this.users.updateLoginState(user.id, updates) : user;
  }
}
