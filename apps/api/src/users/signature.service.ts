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

/** T34 RN-01: folga entre criar a imagem e ela poder ser apagada. */
const CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** T34 RN-02: imagens apagadas por execução. */
export const CLEANUP_BATCH = 200;

/** Ids em `signatureImages` de um payload da outbox (formato da T33 RN-11), sem confiar no JSON. */
function payloadImageIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null || !('signatureImages' in payload)) return [];
  const images: unknown = payload.signatureImages;
  if (!Array.isArray(images)) return [];
  return images.flatMap((image: unknown) =>
    typeof image === 'object' && image !== null && 'id' in image && typeof image.id === 'string'
      ? [image.id]
      : [],
  );
}

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

  /**
   * T34 RN-01 a RN-03: apaga as imagens que não estão na assinatura atual do dono nem em um
   * `reply` `pending` ou `failed`, criadas há mais de 24 h. Arquivo primeiro, depois a linha;
   * se o storage falhar, a linha fica para a próxima execução.
   */
  async deleteUnusedImages(now = new Date()): Promise<{ deleted: number; failed: number }> {
    const candidates = await this.prisma.signatureImage.findMany({
      where: { createdAt: { lt: new Date(now.getTime() - CLEANUP_MIN_AGE_MS) } },
      select: { id: true, storageKey: true, user: { select: { signatureHtml: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const unused = candidates.filter(
      (image) => !referencedSignatureImageIds(image.user.signatureHtml ?? '').includes(image.id),
    );
    if (unused.length === 0) return { deleted: 0, failed: 0 };

    const pending = await this.prisma.notification.findMany({
      where: { template: 'reply', status: { in: ['pending', 'failed'] } },
      select: { payload: true },
    });
    const held = new Set(pending.flatMap((row) => payloadImageIds(row.payload)));
    const deletable = unused.filter((image) => !held.has(image.id)).slice(0, CLEANUP_BATCH);

    let deleted = 0;
    let failed = 0;
    for (const image of deletable) {
      try {
        await this.attachments.deleteObject(image.storageKey);
      } catch {
        failed += 1;
        continue;
      }
      await this.prisma.signatureImage.deleteMany({ where: { id: image.id } });
      deleted += 1;
    }
    return { deleted, failed };
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
