import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  approveAccessSchema,
  listAccessRequestsQuerySchema,
  listUsersQuerySchema,
  rejectAccessSchema,
  updateUserSchema,
  type AccessRequestListResponse,
  type ApproveAccessInput,
  type EmptyTrashResponse,
  type ListAccessRequestsQuery,
  type ListUsersQuery,
  type RejectAccessInput,
  type UpdateUserInput,
  type UserListResponse,
  type UserSummary,
} from '@helpdesk/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { CurrentUser as CurrentUserType } from '../auth/current-user.js';
import { UserCache } from '../auth/user-cache.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { UserProfile } from './users.service.js';
import { UsersService } from './users.service.js';

/**
 * Liberação de acesso ao portal (T22, ADR-011): "admin" aqui inclui `supervisor` (RN-10).
 * Administração de usuários (T15): só `admin`.
 */
@Controller('users')
@Roles('admin', 'supervisor')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly cache: UserCache,
  ) {}

  @Get()
  @Roles('admin')
  listUsers(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<UserListResponse> {
    return this.users.listUsers(query);
  }

  /** T15: o efeito é imediato (o cache do usuário é invalidado), inclusive `active = false`. */
  @Patch(':id')
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() admin: CurrentUserType,
  ): Promise<UserSummary> {
    const { user, zitadelSub } = await this.users.updateByAdmin(id, body, admin.id);
    if (zitadelSub) this.cache.invalidate(zitadelSub);
    return user;
  }

  @Get('access-requests')
  list(
    @Query(new ZodValidationPipe(listAccessRequestsQuerySchema)) query: ListAccessRequestsQuery,
  ): Promise<AccessRequestListResponse> {
    return this.users.listAccessRequests(query);
  }

  @Post(':id/access/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveAccessSchema)) body: ApproveAccessInput,
    @CurrentUser() admin: CurrentUserType,
  ): Promise<UserProfile> {
    const profile = await this.users.approveAccess(id, body, admin.id);
    this.invalidate(profile);
    return profile;
  }

  @Post(':id/access/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectAccessSchema)) body: RejectAccessInput,
    @CurrentUser() admin: CurrentUserType,
  ): Promise<UserProfile> {
    const profile = await this.users.rejectAccess(id, body, admin.id);
    this.invalidate(profile);
    return profile;
  }

  @Post(':id/access/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('id') id: string): Promise<UserProfile> {
    const profile = await this.users.restoreAccess(id);
    this.invalidate(profile);
    return profile;
  }

  @Delete(':id/access/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin')
  async trash(@Param('id') id: string): Promise<void> {
    await this.users.deleteTrashedAccess(id);
  }

  @Delete('access-requests/trash')
  @Roles('admin')
  emptyTrash(): Promise<EmptyTrashResponse> {
    return this.users.emptyTrash();
  }

  /** RN-15: a decisão vale na próxima requisição, não só depois do TTL do cache. */
  private invalidate(profile: UserProfile): void {
    if (profile.zitadelSub) this.cache.invalidate(profile.zitadelSub);
  }
}
