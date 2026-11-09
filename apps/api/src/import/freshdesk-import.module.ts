import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { ConfigModule } from '../config/config.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SlaModule } from '../sla/sla.module.js';
import { FreshdeskImportService } from './freshdesk-import.service.js';

/**
 * T29: só o necessário para o import. Fora do AppModule de propósito: sem HTTP e sem os crons
 * (e-mail de entrada, outbox), que já rodam na API e não podem rodar em dobro.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AttachmentsModule, SlaModule],
  providers: [FreshdeskImportService],
})
export class FreshdeskImportModule {}
