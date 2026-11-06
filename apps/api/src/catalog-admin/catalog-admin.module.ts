import { Module } from '@nestjs/common';
import { CatalogAdminController } from './catalog-admin.controller.js';
import { CatalogAdminService } from './catalog-admin.service.js';

@Module({
  controllers: [CatalogAdminController],
  providers: [CatalogAdminService],
})
export class CatalogAdminModule {}
