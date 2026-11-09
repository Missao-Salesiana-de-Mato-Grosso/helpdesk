import { Module } from '@nestjs/common';
import { SlaService } from './sla.service.js';

@Module({
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
