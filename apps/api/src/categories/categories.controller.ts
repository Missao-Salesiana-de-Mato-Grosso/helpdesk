import { Controller, Get } from '@nestjs/common';
import type { NamedRef } from '@helpdesk/shared';
import { CategoriesService } from './categories.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(): Promise<NamedRef[]> {
    return this.categories.listActive();
  }
}
