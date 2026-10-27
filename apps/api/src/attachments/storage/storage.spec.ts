import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { LocalStorageDriver } from './local-storage.driver.js';
import { S3StorageDriver } from './s3-storage.driver.js';
import { StorageObjectNotFoundError } from './storage-driver.js';

describe('LocalStorageDriver', () => {
  let root: string;
  let driver: LocalStorageDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'helpdesk-storage-'));
    driver = new LocalStorageDriver(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('grava, lê e apaga', async () => {
    await driver.put('attachments/2026/10/abc', Buffer.from('conteúdo'), 'text/plain');
    expect(await text(await driver.get('attachments/2026/10/abc'))).toBe('conteúdo');
    await driver.delete('attachments/2026/10/abc');
    await expect(driver.get('attachments/2026/10/abc')).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
    await expect(driver.delete('attachments/2026/10/abc')).resolves.toBeUndefined();
  });

  it('não sobrescreve uma chave existente', async () => {
    await driver.put('attachments/a', Buffer.from('1'), 'text/plain');
    await expect(driver.put('attachments/a', Buffer.from('2'), 'text/plain')).rejects.toThrow();
  });

  it.each(['../fora', 'attachments/../../fora', '/etc/passwd', 'a/./b', 'a\\b', ''])(
    'recusa a chave %j (path traversal)',
    async (key) => {
      await expect(driver.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(
        /inválida|fora/,
      );
    },
  );
});

describe('S3StorageDriver', () => {
  const send = vi.fn();
  const driver = new S3StorageDriver({ send }, 'helpdesk-anexos');

  beforeEach(() => send.mockReset());

  it('put envia bucket, chave, tipo e tamanho', async () => {
    send.mockResolvedValue({});
    await driver.put('attachments/x', Buffer.from('abc'), 'application/pdf');
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'helpdesk-anexos',
      Key: 'attachments/x',
      ContentType: 'application/pdf',
      ContentLength: 3,
    });
  });

  it('get devolve o stream; NoSuchKey vira StorageObjectNotFoundError', async () => {
    send.mockResolvedValueOnce({ Body: Readable.from(['oi']) });
    expect(await text(await driver.get('attachments/x'))).toBe('oi');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    send.mockRejectedValueOnce(new NoSuchKey({ message: 'no', $metadata: {} }));
    await expect(driver.get('attachments/y')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('delete usa DeleteObject; chave insegura é recusada antes de chamar o S3', async () => {
    send.mockResolvedValue({});
    await driver.delete('attachments/x');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    await expect(driver.delete('../x')).rejects.toThrow(/inválida/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
