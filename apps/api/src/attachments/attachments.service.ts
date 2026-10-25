import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ApiErrorCode,
  attachmentMimeType,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sanitizeFilename } from './filename.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage-driver.js';

/** Arquivo recebido (multipart ou e-mail), ainda só em memória. */
export interface IncomingFile {
  filename: string;
  buffer: Buffer;
}

/** Arquivo já gravado no storage, pronto para virar linha em `attachments`. */
export interface StoredFile {
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentRecord extends StoredFile {
  id: string;
  messageId: string;
}

export const fileTooLarge = () =>
  new ApiException(
    HttpStatus.PAYLOAD_TOO_LARGE,
    ApiErrorCode.FILE_TOO_LARGE,
    `Cada arquivo pode ter no máximo ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`,
  );

export const tooManyFiles = () =>
  new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ApiErrorCode.TOO_MANY_FILES,
    `Envie no máximo ${ATTACHMENT_MAX_FILES} arquivos por mensagem.`,
  );

const unsupportedType = (filename: string) =>
  new ApiException(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    ApiErrorCode.UNSUPPORTED_FILE_TYPE,
    `Tipo de arquivo não aceito: ${filename}`,
  );

/**
 * Anexos (T13): valida, grava os bytes no storage (driver `local` ou `s3`) e as linhas em
 * `attachments`. Nunca loga o conteúdo dos arquivos, só chaves e tamanhos.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** Quantidade, tamanho e tipo (pela extensão). Roda antes de gravar qualquer coisa. */
  validate(files: readonly IncomingFile[]): void {
    if (files.length > ATTACHMENT_MAX_FILES) throw tooManyFiles();
    for (const file of files) this.mimeTypeOf(file);
  }

  /** Grava todos ou nenhum: se um falhar, apaga os que já foram. */
  async storeAll(files: readonly IncomingFile[]): Promise<StoredFile[]> {
    this.validate(files);
    const stored: StoredFile[] = [];
    try {
      for (const file of files) stored.push(await this.storeFromBuffer(file.buffer, file));
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
    return stored;
  }

  /** Também usado pela T21 para os anexos que chegam por e-mail. */
  async storeFromBuffer(buffer: Buffer, { filename }: { filename: string }): Promise<StoredFile> {
    const file = { filename: sanitizeFilename(filename), buffer };
    const mimeType = this.mimeTypeOf(file);
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `attachments/${now.getUTCFullYear()}/${month}/${randomUUID()}`;
    await this.storage.put(storageKey, buffer, mimeType);
    return { storageKey, filename: file.filename, mimeType, sizeBytes: buffer.length };
  }

  /** Remove do storage arquivos cuja gravação no banco não aconteceu. Melhor esforço. */
  async discard(files: readonly StoredFile[]): Promise<void> {
    for (const file of files) {
      try {
        await this.storage.delete(file.storageKey);
      } catch (error) {
        this.logger.warn(
          `Não foi possível apagar ${file.storageKey} do storage: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      }
    }
  }

  /** Linhas em `attachments`, dentro da transação da mensagem. */
  async createRecords(
    tx: Prisma.TransactionClient,
    messageId: string,
    files: readonly StoredFile[],
  ): Promise<void> {
    if (files.length === 0) return;
    // `now()` é o mesmo em toda a transação: 1 ms entre os anexos preserva a ordem do envio.
    const base = Date.now();
    await tx.attachment.createMany({
      data: files.map((file, index) => ({
        ...file,
        messageId,
        createdAt: new Date(base + index),
      })),
    });
  }

  findById(id: string): Promise<AttachmentRecord | null> {
    return this.prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        messageId: true,
        storageKey: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
  }

  open(storageKey: string): Promise<Readable> {
    return this.storage.get(storageKey);
  }

  private mimeTypeOf(file: IncomingFile): string {
    if (file.buffer.length > ATTACHMENT_MAX_BYTES) throw fileTooLarge();
    const mimeType = attachmentMimeType(file.filename);
    if (!mimeType) throw unsupportedType(sanitizeFilename(file.filename));
    return mimeType;
  }
}
