import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiErrorCode, type NamedRef } from '@helpdesk/shared';
import { Roles } from '../auth/decorators.js';
import { ApiException } from '../common/api-exception.js';
import { GroupsService } from './groups.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('groups')
@Roles('agente', 'supervisor', 'admin')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(): Promise<NamedRef[]> {
    return this.groups.listActive();
  }

  @Get(':id/members')
  async members(@Param('id') id: string): Promise<NamedRef[]> {
    const members = UUID.test(id) ? await this.groups.listAssignableMembers(id) : null;
    if (!members) {
      throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Grupo não encontrado.');
    }
    return members;
  }
}
