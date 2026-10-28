import { Module } from '@nestjs/common';
import { UserCache } from './user-cache.js';

// Módulo próprio só para evitar um ciclo AuthModule ↔ UsersModule: os dois precisam do
// UserCache (RN-15, T22) sem precisar um do outro por causa dele.
@Module({
  providers: [UserCache],
  exports: [UserCache],
})
export class UserCacheModule {}
