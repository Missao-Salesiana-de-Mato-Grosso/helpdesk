import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const userWithGroupIds = {
  include: { groupMemberships: { select: { groupId: true } } },
} satisfies Prisma.UserDefaultArgs;

export type UserWithGroupIds = Prisma.UserGetPayload<typeof userWithGroupIds>;

const userProfile = {
  include: {
    company: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    groupMemberships: {
      where: { group: { active: true } },
      select: { group: { select: { id: true, name: true } } },
      orderBy: { group: { name: 'asc' } },
    },
  },
} satisfies Prisma.UserDefaultArgs;

export type UserProfile = Prisma.UserGetPayload<typeof userProfile>;

export interface NewLoginUser {
  zitadelSub: string;
  email: string;
  name: string;
  roles: string[];
}

/** Acesso à tabela `users`. Outros módulos passam por aqui, nunca pelo Prisma diretamente. */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<UserWithGroupIds | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userWithGroupIds });
  }

  findBySub(zitadelSub: string): Promise<UserWithGroupIds | null> {
    return this.prisma.user.findUnique({ where: { zitadelSub }, ...userWithGroupIds });
  }

  /** `email` é citext: a comparação já é case-insensitive. */
  findByEmail(email: string): Promise<UserWithGroupIds | null> {
    return this.prisma.user.findUnique({ where: { email }, ...userWithGroupIds });
  }

  createFromLogin(data: NewLoginUser, now: Date): Promise<UserWithGroupIds> {
    return this.prisma.user.create({
      data: { ...data, lastLoginAt: now, profileSyncedAt: now },
      ...userWithGroupIds,
    });
  }

  /** Vincula ao login um usuário criado pelo canal de e-mail (RN-10.2). */
  linkToLogin(id: string, data: NewLoginUser, now: Date): Promise<UserWithGroupIds> {
    return this.prisma.user.update({
      where: { id },
      data: {
        zitadelSub: data.zitadelSub,
        name: data.name,
        roles: data.roles,
        lastLoginAt: now,
        profileSyncedAt: now,
      },
      ...userWithGroupIds,
    });
  }

  updateLoginState(
    id: string,
    data: Pick<
      Prisma.UserUpdateInput,
      'roles' | 'lastLoginAt' | 'profileSyncedAt' | 'name' | 'email'
    >,
  ): Promise<UserWithGroupIds> {
    return this.prisma.user.update({ where: { id }, data, ...userWithGroupIds });
  }

  findProfile(id: string): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userProfile });
  }

  /** Grava a unidade no usuário (triagem de ticket, RN-28 da spec T08–T10). */
  async setCompany(id: string, companyId: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { companyId } });
  }

  setCompanyAndDepartment(
    id: string,
    companyId: string,
    departmentId: string,
  ): Promise<UserProfile> {
    return this.prisma.user.update({
      where: { id },
      data: { companyId, departmentId },
      ...userProfile,
    });
  }
}
