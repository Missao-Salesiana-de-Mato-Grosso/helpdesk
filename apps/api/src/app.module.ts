import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { CompaniesModule } from './companies/companies.module.js';
import { ConfigModule } from './config/config.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    DepartmentsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
