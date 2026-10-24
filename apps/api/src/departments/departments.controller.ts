import { Controller, Get } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { AllowDuringOnboarding } from '../auth/decorators.js';
import { DepartmentsService } from './departments.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @AllowDuringOnboarding()
  list(): Promise<NamedRef[]> {
    return this.departments.listActive();
  }
}
