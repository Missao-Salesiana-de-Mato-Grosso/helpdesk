import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators.js';
import { ZitadelEventsService } from './zitadel-events.service.js';
import { ZITADEL_SIGNATURE_HEADER } from './zitadel-signature.js';

/**
 * T39: chamada do Zitadel (Actions v2). Pública porque o Zitadel não manda token: quem autentica
 * é a assinatura HMAC sobre o corpo bruto (RN-01).
 */
@Controller('integrations/zitadel')
export class ZitadelEventsController {
  constructor(private readonly events: ZitadelEventsService) {}

  @Public()
  @Post('events')
  @HttpCode(200)
  handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers(ZITADEL_SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<{ handled: boolean }> {
    return this.events.handle(request.rawBody, signature);
  }
}
