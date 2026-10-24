import { Controller, Get } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { AllowDuringOnboarding } from '../auth/decorators.js';
import { CompaniesService } from './companies.service.js';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @AllowDuringOnboarding()
  list(): Promise<NamedRef[]> {
    return this.companies.listActive();
  }
}
