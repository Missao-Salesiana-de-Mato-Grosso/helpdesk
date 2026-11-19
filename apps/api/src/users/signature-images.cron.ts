import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SignatureService } from './signature.service.js';

/**
 * T34: apaga, uma vez por dia, as imagens que saíram da assinatura e nenhum e-mail pendente
 * usa. Loga só contagens (RN-05).
 */
@Injectable()
export class SignatureImagesCron {
  private readonly logger = new Logger(SignatureImagesCron.name);
  private running = false;

  constructor(private readonly signatures: SignatureService) {}

  // RN-02: 3h30, depois da lixeira de pedidos de acesso (3h).
  @Cron('30 3 * * *', { name: 'signature-images-cleanup' })
  async tick(): Promise<void> {
    // RN-04: uma execução por vez.
    if (this.running) return;
    this.running = true;
    try {
      const { deleted, failed } = await this.signatures.deleteUnusedImages();
      if (deleted > 0 || failed > 0) {
        this.logger.log(
          `Imagens da assinatura: ${deleted} apagada(s), ${failed} com falha no storage`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Limpeza das imagens da assinatura falhou: ${error instanceof Error ? error.message : 'erro'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
