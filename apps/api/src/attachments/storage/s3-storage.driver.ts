import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { assertSafeKey, StorageObjectNotFoundError, type StorageDriver } from './storage-driver.js';

/** Driver S3 (Object Storage da Magalu em produção). O bucket é privado; o acesso passa pela API. */
export class S3StorageDriver implements StorageDriver {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    assertSafeKey(key);
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!(output.Body instanceof Readable)) throw new StorageObjectNotFoundError(key);
      return output.Body;
    } catch (error) {
      if (error instanceof NoSuchKey) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
