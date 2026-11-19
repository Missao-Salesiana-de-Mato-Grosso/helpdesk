// Spec docs/specs/T34-limpeza-imagens-assinatura.md — limpeza diária das imagens da assinatura.
import { randomUUID } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { SignatureImagesCron } from '../src/users/signature-images.cron.js';
import { E2E_STORAGE_PATH } from '../vitest.config.e2e.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

const DAY = 24 * 60 * 60 * 1000;

const exists = async (storageKey: string) =>
  access(join(E2E_STORAGE_PATH, storageKey)).then(
    () => true,
    () => false,
  );

describe('limpeza das imagens da assinatura — T34 (e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;
  let attachments: AttachmentsService;
  let cron: SignatureImagesCron;

  beforeAll(async () => {
    t = await createTestApp();
    attachments = t.app.get(AttachmentsService);
    cron = t.app.get(SignatureImagesCron);
  });

  afterAll(async () => {
    await t.app.close();
    await rm(E2E_STORAGE_PATH, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    await rm(E2E_STORAGE_PATH, { recursive: true, force: true });
    t.cache.clear();
    vi.restoreAllMocks();
    f = await createTicketsFixture(t);
  });

  /** Imagem de ag1 gravada no storage, criada `ageDays` dias atrás. */
  async function image(ageDays = 2) {
    const stored = await attachments.storeFromBuffer(Buffer.from('logo'), { filename: 'logo.png' });
    const id = randomUUID();
    await t.prisma.signatureImage.create({
      data: {
        id,
        userId: f.users.ag1,
        ...stored,
        createdAt: new Date(Date.now() - ageDays * DAY),
      },
    });
    return { id, storageKey: stored.storageKey };
  }

  const sign = (ids: string[]) =>
    t.prisma.user.update({
      where: { id: f.users.ag1 },
      data: {
        signatureHtml: `<p>Ag Um</p>${ids.map((id) => `<img data-signature-image-id="${id}" />`).join('')}`,
      },
    });

  const outbox = (status: 'pending' | 'failed' | 'sent', id: string) =>
    t.prisma.notification.create({
      data: {
        toEmail: 'req1@missaosalesiana.org.br',
        template: 'reply',
        status,
        payload: { signatureImages: [{ id, storageKey: 'x', filename: 'logo.png' }] },
      },
    });

  const remaining = async () =>
    (await t.prisma.signatureImage.findMany({ select: { id: true } })).map((row) => row.id);

  it('CT-01 imagem fora da assinatura, antiga e sem e-mail pendente: arquivo e linha somem', async () => {
    const old = await image();
    await sign([]);
    await cron.tick();
    expect(await remaining()).toEqual([]);
    expect(await exists(old.storageKey)).toBe(false);
  });

  it('CT-02 imagem ainda na assinatura atual fica', async () => {
    const current = await image();
    await sign([current.id]);
    await cron.tick();
    expect(await remaining()).toEqual([current.id]);
    expect(await exists(current.storageKey)).toBe(true);
  });

  it('CT-03 e-mail pending ou failed segura a imagem; sent não', async () => {
    const pending = await image();
    const failed = await image();
    const sent = await image();
    await sign([]);
    await outbox('pending', pending.id);
    await outbox('failed', failed.id);
    await outbox('sent', sent.id);

    await cron.tick();
    expect((await remaining()).toSorted()).toEqual([pending.id, failed.id].toSorted());
    expect(await exists(sent.storageKey)).toBe(false);
  });

  it('CT-04 imagem criada há menos de 24 h fica', async () => {
    const fresh = await image(0.5);
    await sign([]);
    await cron.tick();
    expect(await remaining()).toEqual([fresh.id]);
  });

  it('CT-05 falha do storage numa imagem: a linha dela fica e as outras saem', async () => {
    const broken = await image();
    const ok = await image();
    await sign([]);
    const real = attachments.deleteObject.bind(attachments);
    vi.spyOn(attachments, 'deleteObject').mockImplementation(async (key) => {
      if (key === broken.storageKey) throw new Error('storage fora');
      await real(key);
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await cron.tick();
    expect(await remaining()).toEqual([broken.id]);
    expect(await exists(ok.storageKey)).toBe(false);
  });

  it('CT-06 o log só traz contagens: sem chave no storage nem nome do arquivo', async () => {
    const old = await image();
    await sign([]);
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }

    await cron.tick();
    const all = logs.join('\n');
    expect(all).toContain('1 apagada(s)');
    expect(all).not.toContain(old.storageKey);
    expect(all).not.toContain('logo.png');
  });
});
