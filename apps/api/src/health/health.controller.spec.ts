import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';

// Unitário: o PrismaService é substituído por um dublê; a verificação real do banco fica no e2e.
async function buildController(prismaStub: Partial<PrismaService>): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [DatabaseHealthIndicator, { provide: PrismaService, useValue: prismaStub }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const controller = await buildController({
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    });
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.details['database']?.status).toBe('up');
  });

  it('fails with 503 when the database does not answer', async () => {
    const controller = await buildController({
      $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    await expect(controller.check()).rejects.toMatchObject({ status: 503 });
  });
});
