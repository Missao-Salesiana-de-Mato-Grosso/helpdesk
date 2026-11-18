import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  SIGNATURE_IMAGE_MAX_BYTES,
  SIGNATURE_IMAGE_MAX_FILES,
  signatureImageMimeType,
  type UpdateSignatureInput,
} from '@helpdesk/shared';
import {
  AttachmentsService,
  type IncomingFile,
  type StoredFile,
} from '../attachments/attachments.service.js';
import { sanitizeFilename } from '../attachments/filename.js';
import { StorageObjectNotFoundError } from '../attachments/storage/storage-driver.js';
import { ApiException } from '../common/api-exception.js';
import {
  SIGNATURE_IMAGE_ATTRIBUTE,
  referencedSignatureImageIds,
  sanitizeSignatureHtml,
} from '../common/sanitize-html.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Imagem da assinatura como vai para o payload da outbox (T33 RN-11). */
export interface SignatureImageRecord {
  id: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

const imageNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Imagem não encontrada.');

const invalid = (message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.VALIDATION_ERROR, message);

const IMAGE_SELECT = {
  id: true,
  storageKey: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
} as const;

/**
 * Assinatura de e-mail do agente com imagens (T31 + T33). As imagens ficam em
 * `signature_images`, no storage dos anexos, e nunca são apagadas daqui (RN-08).
 */
@Injectable()
export class SignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
  ) {}

  async signatureOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { signatureHtml: true },
    });
    return user?.signatureHtml ?? null;
  }

  /**
   * RN-02 a RN-07: imagens novas (`data-inline-key` + arquivo) ganham um id agora; as que já
   * estavam valem se forem do próprio usuário. Devolve a assinatura gravada.
   */
  async save(
    userId: string,
    input: UpdateSignatureInput,
    inline: readonly IncomingFile[],
  ): Promise<string | null> {
    const keys = input.inlineImages ?? [];
    if (keys.length !== inline.length) {
      throw invalid('inlineImages: a quantidade de chaves não confere com a de imagens enviadas');
    }
    for (const file of inline) validateImage(file);

    const owned = new Set(
      (await this.prisma.signatureImage.findMany({ where: { userId }, select: { id: true } })).map(
        (image) => image.id,
      ),
    );
    const byKey = new Map(
      keys.map((key, index) => [key, { id: randomUUID(), file: inline[index]! }]),
    );
    const signatureHtml = sanitizeSignatureHtml(input.signatureHtml, (attribs) => {
      const key = attribs['data-inline-key'];
      if (key !== undefined) return byKey.get(key)?.id;
      const id = attribs[SIGNATURE_IMAGE_ATTRIBUTE];
      return id !== undefined && owned.has(id) ? id : undefined;
    });

    const referenced = signatureHtml ? referencedSignatureImageIds(signatureHtml) : [];
    if (referenced.length > SIGNATURE_IMAGE_MAX_FILES) {
      throw invalid(`A assinatura pode ter no máximo ${SIGNATURE_IMAGE_MAX_FILES} imagens`);
    }
    const fresh = [...byKey.values()].filter((image) => referenced.includes(image.id));

    const stored: (StoredFile & { id: string })[] = [];
    try {
      for (const { id, file } of fresh) {
        stored.push({ ...(await this.attachments.storeFromBuffer(file.buffer, file)), id });
      }
      await this.prisma.$transaction(async (tx) => {
        if (stored.length > 0) {
          await tx.signatureImage.createMany({
            data: stored.map(({ id, storageKey, filename, mimeType, sizeBytes }) => ({
              id,
              userId,
              storageKey,
              filename,
              mimeType,
              sizeBytes,
            })),
          });
        }
        await tx.user.update({ where: { id: userId }, data: { signatureHtml } });
      });
    } catch (error) {
      await this.attachments.discard(stored);
      throw error;
    }
    return signatureHtml;
  }

  /** RN-11: as imagens que a assinatura referencia, para congelar no payload. */
  async imagesIn(userId: string, signatureHtml: string): Promise<SignatureImageRecord[]> {
    const ids = referencedSignatureImageIds(signatureHtml);
    if (ids.length === 0) return [];
    const images = await this.prisma.signatureImage.findMany({
      where: { userId, id: { in: ids } },
      select: IMAGE_SELECT,
    });
    return ids.flatMap((id) => images.filter((image) => image.id === id));
  }

  /** RN-09: só a própria imagem; qualquer outra coisa → 404. */
  async openImage(
    userId: string,
    id: string,
  ): Promise<{ image: SignatureImageRecord; stream: Readable }> {
    if (!UUID.test(id)) throw imageNotFound();
    const image = await this.prisma.signatureImage.findFirst({
      where: { id, userId },
      select: IMAGE_SELECT,
    });
    if (!image) throw imageNotFound();
    try {
      return { image, stream: await this.attachments.open(image.storageKey) };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) throw imageNotFound();
      throw error;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RN-02 e RN-03. */
function validateImage(file: IncomingFile): void {
  const name = sanitizeFilename(file.filename);
  if (!signatureImageMimeType(name)) {
    throw new ApiException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      ApiErrorCode.UNSUPPORTED_FILE_TYPE,
      `Só imagens PNG ou JPG na assinatura: ${name}`,
    );
  }
  if (file.buffer.length > SIGNATURE_IMAGE_MAX_BYTES) {
    throw new ApiException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      ApiErrorCode.FILE_TOO_LARGE,
      `Cada imagem da assinatura pode ter no máximo ${SIGNATURE_IMAGE_MAX_BYTES / 1024} KB.`,
    );
  }
}
