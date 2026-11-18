import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { UserCacheModule } from '../auth/user-cache.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { DepartmentsModule } from '../departments/departments.module.js';
import { AccessRequestsCron } from './access-requests.cron.js';
import { SignatureService } from './signature.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  // UserCacheModule é independente do AuthModule: evita um ciclo entre os dois módulos
  // (AuthModule já importa UsersModule pelo UsersService); UsersController precisa do
  // UserCache para invalidar o cache na decisão de acesso (RN-15, T22).
  // AttachmentsModule: storage das imagens da assinatura (T33).
  imports: [UserCacheModule, CompaniesModule, DepartmentsModule, AttachmentsModule],
  controllers: [UsersController],
  providers: [UsersService, SignatureService, AccessRequestsCron],
  exports: [UsersService, SignatureService],
})
export class UsersModule {}
