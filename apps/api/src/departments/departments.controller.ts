import { Controller, Get } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { AllowDuringOnboarding, AllowWhilePending } from '../auth/decorators.js';
import { DepartmentsService } from './departments.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @AllowDuringOnboarding()
  @AllowWhilePending()
  list(): Promise<NamedRef[]> {
    return this.departments.listActive();
  }
}
