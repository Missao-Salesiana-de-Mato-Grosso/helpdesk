import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { Public } from '../auth/decorators.js';
import { DatabaseHealthIndicator } from './database.health.js';

// Liveness/readiness do Kubernetes. Falha se o PostgreSQL não responder.
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.isHealthy()]);
  }
}
