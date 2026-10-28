import { Body, Controller, Get, HttpStatus, Patch } from '@nestjs/common';
import {
  ApiErrorCode,
  ROLES,
  updateMeSchema,
  type MeResponse,
  type UpdateMeInput,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CompaniesService } from '../companies/companies.service.js';
import { DepartmentsService } from '../departments/departments.service.js';
import { UsersService, type UserProfile } from '../users/users.service.js';
import type { CurrentUser as CurrentUserType } from './current-user.js';
import { AllowDuringOnboarding, AllowWhilePending, CurrentUser } from './decorators.js';
import { UserCache } from './user-cache.js';

@Controller('me')
@AllowDuringOnboarding()
@AllowWhilePending()
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly companies: CompaniesService,
    private readonly departments: DepartmentsService,
    private readonly cache: UserCache,
  ) {}

  @Get()
  async get(@CurrentUser() user: CurrentUserType): Promise<MeResponse> {
    const profile = await this.users.findProfile(user.id);
    if (!profile)
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.NOT_FOUND,
        'Usuário não encontrado.',
      );
    return toMeResponse(profile, user);
  }

  /** Tela de 1º acesso (RN-15). */
  @Patch()
  async update(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ): Promise<MeResponse> {
    const [companyOk, departmentOk] = await Promise.all([
      this.companies.isActive(body.companyId),
      this.departments.isActive(body.departmentId),
    ]);
    if (!companyOk || !departmentOk) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.VALIDATION_ERROR,
        !companyOk ? 'Unidade inexistente ou inativa.' : 'Departamento inexistente ou inativo.',
      );
    }
    const profile = await this.users.setCompanyAndDepartment(
      user.id,
      body.companyId,
      body.departmentId,
    );
    this.cache.invalidate(user.zitadelSub);
    return toMeResponse(profile, user);
  }
}

function toMeResponse(profile: UserProfile, user: CurrentUserType): MeResponse {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    roles: ROLES.filter((role) => user.roles.includes(role)),
    isAgent: user.isAgent,
    company: profile.company,
    department: profile.department,
    groups: user.isAgent ? profile.groupMemberships.map((m) => m.group) : [],
    needsOnboarding: profile.companyId === null || profile.departmentId === null,
    accessStatus: user.accessStatus,
  };
}
