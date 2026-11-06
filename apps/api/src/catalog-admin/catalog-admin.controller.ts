import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createCatalogItemSchema,
  createCategorySchema,
  createGroupSchema,
  updateCatalogItemSchema,
  updateCategorySchema,
  updateGroupSchema,
  type CatalogItem,
  type CategoryItem,
  type CreateCatalogItemInput,
  type CreateCategoryInput,
  type CreateGroupInput,
  type GroupItem,
  type UpdateCatalogItemInput,
  type UpdateCategoryInput,
  type UpdateGroupInput,
} from '@helpdesk/shared';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogAdminService } from './catalog-admin.service.js';

/**
 * T25: cadastros de referência — só admin. As listas daqui incluem os inativos; as rotas públicas
 * (`GET /companies`, `/departments`, `/groups`, `/categories`) seguem só com os ativos.
 */
@Controller('admin')
@Roles('admin')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}

  @Get('companies')
  listCompanies(): Promise<CatalogItem[]> {
    return this.catalog.listCompanies();
  }

  @Post('companies')
  createCompany(
    @Body(new ZodValidationPipe(createCatalogItemSchema)) body: CreateCatalogItemInput,
  ): Promise<CatalogItem> {
    return this.catalog.createCompany(body);
  }

  @Patch('companies/:id')
  updateCompany(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCatalogItemSchema)) body: UpdateCatalogItemInput,
  ): Promise<CatalogItem> {
    return this.catalog.updateCompany(id, body);
  }

  @Get('departments')
  listDepartments(): Promise<CatalogItem[]> {
    return this.catalog.listDepartments();
  }

  @Post('departments')
  createDepartment(
    @Body(new ZodValidationPipe(createCatalogItemSchema)) body: CreateCatalogItemInput,
  ): Promise<CatalogItem> {
    return this.catalog.createDepartment(body);
  }

  @Patch('departments/:id')
  updateDepartment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCatalogItemSchema)) body: UpdateCatalogItemInput,
  ): Promise<CatalogItem> {
    return this.catalog.updateDepartment(id, body);
  }

  @Get('groups')
  listGroups(): Promise<GroupItem[]> {
    return this.catalog.listGroups();
  }

  @Post('groups')
  createGroup(
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ): Promise<GroupItem> {
    return this.catalog.createGroup(body);
  }

  @Patch('groups/:id')
  updateGroup(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupInput,
  ): Promise<GroupItem> {
    return this.catalog.updateGroup(id, body);
  }

  @Get('categories')
  listCategories(): Promise<CategoryItem[]> {
    return this.catalog.listCategories();
  }

  @Post('categories')
  createCategory(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ): Promise<CategoryItem> {
    return this.catalog.createCategory(body);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ): Promise<CategoryItem> {
    return this.catalog.updateCategory(id, body);
  }
}
