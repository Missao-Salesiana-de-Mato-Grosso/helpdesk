import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AttachmentsService } from './attachments.service.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import { S3StorageDriver } from './storage/s3-storage.driver.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage-driver.js';

@Module({
  providers: [
    AttachmentsService,
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): StorageDriver => {
        const env = {
          STORAGE_DRIVER: config.get('STORAGE_DRIVER', { infer: true }),
          STORAGE_LOCAL_PATH: config.get('STORAGE_LOCAL_PATH', { infer: true }),
          S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
          S3_REGION: config.get('S3_REGION', { infer: true }),
          S3_BUCKET: config.get('S3_BUCKET', { infer: true }),
          S3_ACCESS_KEY: config.get('S3_ACCESS_KEY', { infer: true }),
          S3_SECRET_KEY: config.get('S3_SECRET_KEY', { infer: true }),
        };
        if (env.STORAGE_DRIVER === 'local') return new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
        // O env já garante as variáveis S3_* quando o driver é s3 (config/env.ts).
        const client = new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY ?? '',
            secretAccessKey: env.S3_SECRET_KEY ?? '',
          },
        });
        return new S3StorageDriver(client, env.S3_BUCKET ?? '');
      },
    },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
