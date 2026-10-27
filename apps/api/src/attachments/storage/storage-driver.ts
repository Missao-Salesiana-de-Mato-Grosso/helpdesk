import type { Readable } from 'node:stream';

/** Onde os bytes dos anexos (e, na T21, dos `.eml` brutos) ficam. As chaves são geradas pela API. */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Stream do objeto; lança `StorageObjectNotFoundError` se não existe. */
  get(key: string): Promise<Readable>;
  /** Idempotente: apagar uma chave inexistente não é erro. */
  delete(key: string): Promise<void>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Objeto não encontrado no storage: ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/** Chaves só com segmentos simples: nada de `..`, barra inicial ou caracteres especiais. */
const SAFE_KEY = /^[a-z0-9-]+(?:\/[a-z0-9.-]+)*$/i;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Chave de storage inválida: ${key}`);
  }
}
