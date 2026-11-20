import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SignatureService } from './signature.service.js';

export const CLEANUP_TIME_ZONE = 'America/Cuiaba';

/**
 * T34: apaga, uma vez por dia, as imagens que saíram da assinatura e nenhum e-mail pendente
 * usa. Loga só contagens, em toda execução (RN-05).
 */
@Injectable()
export class SignatureImagesCron {
  private readonly logger = new Logger(SignatureImagesCron.name);
  private running = false;

  constructor(private readonly signatures: SignatureService) {}

  // RN-02: 3h30 em Cuiabá. Fuso fixo porque o decorator não lê config; é o padrão do
  // BUSINESS_TIMEZONE. Sem ele, o job roda no fuso do container (UTC).
  @Cron('30 3 * * *', { name: 'signature-images-cleanup', timeZone: CLEANUP_TIME_ZONE })
  async tick(): Promise<void> {
    // RN-04: uma execução por vez.
    if (this.running) return;
    this.running = true;
    try {
      const { deleted, failed } = await this.signatures.deleteUnusedImages();
      // RN-05: uma linha em toda execução, mesmo sem nada apagado, para mostrar que rodou.
      this.logger.log(
        `Imagens da assinatura: ${deleted} apagada(s), ${failed} com falha no storage`,
      );
    } catch (error) {
      this.logger.error(
        `Limpeza das imagens da assinatura falhou: ${error instanceof Error ? error.message : 'erro'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
