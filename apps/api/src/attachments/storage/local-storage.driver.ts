import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { assertSafeKey, StorageObjectNotFoundError, type StorageDriver } from './storage-driver.js';

/** Driver de disco (dev e testes). Toda chave é resolvida dentro de `root`. */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    assertSafeKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Chave fora do storage: ${key}`);
    return path;
  }

  // O tipo não é gravado em disco: o download usa o `mime_type` da tabela `attachments`.
  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: 'wx' });
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathOf(key);
    try {
      await stat(path);
    } catch {
      throw new StorageObjectNotFoundError(key);
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
}
