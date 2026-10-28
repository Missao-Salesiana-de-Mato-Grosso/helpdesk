import { Body, Controller, Get, HttpStatus, Param, Put } from '@nestjs/common';
import {
  ApiErrorCode,
  replaceGroupMembersSchema,
  type NamedRef,
  type ReplaceGroupMembersInput,
} from '@helpdesk/shared';
import { Roles } from '../auth/decorators.js';
import { UserCache } from '../auth/user-cache.js';
import { ApiException } from '../common/api-exception.js';
import { isUuid } from '../common/uuid.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GroupsService } from './groups.service.js';

const groupNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Grupo não encontrado.');

@Controller('groups')
@Roles('agente', 'supervisor', 'admin')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly cache: UserCache,
  ) {}

  @Get()
  list(): Promise<NamedRef[]> {
    return this.groups.listActive();
  }

  @Get(':id/members')
  async members(@Param('id') id: string): Promise<NamedRef[]> {
    const members = isUuid(id) ? await this.groups.listAssignableMembers(id) : null;
    if (!members) throw groupNotFound();
    return members;
  }

  /**
   * T15: substitui os membros. Os grupos de cada usuário definem o escopo dos tickets, então o
   * cache de quem entrou ou saiu é invalidado (efeito imediato).
   */
  @Put(':id/members')
  @Roles('admin')
  async replaceMembers(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replaceGroupMembersSchema)) body: ReplaceGroupMembersInput,
  ): Promise<NamedRef[]> {
    const result = isUuid(id) ? await this.groups.replaceMembers(id, body.userIds) : null;
    if (!result) throw groupNotFound();
    for (const sub of result.affectedSubs) this.cache.invalidate(sub);
    return result.members;
  }
}
