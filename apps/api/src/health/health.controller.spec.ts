import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports ok when there are no failing indicators', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.check();

    expect(result.status).toBe('ok');
  });
});
