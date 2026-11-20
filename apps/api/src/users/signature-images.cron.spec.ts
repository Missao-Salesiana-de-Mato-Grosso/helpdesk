import { Logger } from '@nestjs/common';
// Constante interna do @nestjs/schedule: chave dos metadados que o @Cron grava no método.
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
import { SignatureImagesCron } from './signature-images.cron.js';
import type { SignatureService } from './signature.service.js';

const cronWith = (deleteUnusedImages: () => Promise<{ deleted: number; failed: number }>) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- só o método usado pelo cron.
  new SignatureImagesCron({ deleteUnusedImages } as unknown as SignatureService);

describe('SignatureImagesCron (spec T34)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('CT-07 não começa outra execução enquanto uma está rodando', async () => {
    let finish: ((value: { deleted: number; failed: number }) => void) | undefined;
    const run = vi
      .fn<() => Promise<{ deleted: number; failed: number }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ deleted: 0, failed: 0 });
    const cron = cronWith(run);
    const first = cron.tick();
    await cron.tick();
    expect(run).toHaveBeenCalledTimes(1);
    finish?.({ deleted: 0, failed: 0 });
    await first;
    await cron.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('CT-07 um erro não escapa do tick e libera a próxima execução', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValueOnce(new Error('banco fora')).mockResolvedValue({
      deleted: 1,
      failed: 0,
    });
    const cron = cronWith(run);
    await expect(cron.tick()).resolves.toBeUndefined();
    await cron.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('CT-08 loga a contagem mesmo quando nada foi apagado', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await cronWith(() => Promise.resolve({ deleted: 0, failed: 0 })).tick();
    expect(log).toHaveBeenCalledWith('Imagens da assinatura: 0 apagada(s), 0 com falha no storage');
  });

  it('CT-09 roda às 3h30 no fuso de Cuiabá', () => {
    const tick: unknown = Object.getOwnPropertyDescriptor(
      SignatureImagesCron.prototype,
      'tick',
    )?.value;
    const options: unknown = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, tick as object);
    expect(options).toMatchObject({ cronTime: '30 3 * * *', timeZone: 'America/Cuiaba' });
  });
});
