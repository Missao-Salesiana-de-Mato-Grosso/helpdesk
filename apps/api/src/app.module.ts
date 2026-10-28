import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { loggerParams } from './common/logger.js';
import { CategoriesModule } from './categories/categories.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { HealthModule } from './health/health.module.js';
import { InboundEmailModule } from './inbound-email/inbound-email.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerParams({ LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }) }),
    }),
    // Limite por IP (T18). O `trust proxy` do main.ts faz `req.ip` ser o cliente, não o Traefik.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    DepartmentsModule,
    CategoriesModule,
    GroupsModule,
    TicketsModule,
    InboundEmailModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
