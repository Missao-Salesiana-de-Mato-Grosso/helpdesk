import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiErrorCode } from '@helpdesk/shared';
import { z } from 'zod';
import { UserCache } from '../auth/user-cache.js';
import { ApiException } from '../common/api-exception.js';
import type { Env } from '../config/env.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { UsersService } from '../users/users.service.js';
import { verifyZitadelSignature } from './zitadel-signature.js';

/** T39 RN-05: eventos do Zitadel v4.19.5 que desativam a pessoa no help desk. */
export const DEACTIVATING_EVENTS: ReadonlySet<string> = new Set([
  'user.deactivated',
  'user.locked',
  'user.removed',
]);

/** Só os campos lidos do corpo que o Zitadel envia (Actions v2, condição por evento). */
const zitadelEventSchema = z.object({
  aggregateID: z.string().min(1),
  aggregateType: z.string().optional(),
  event_type: z.string().min(1),
});

/**
 * T39: avisos do Zitadel (Actions v2, webhook assinado). Desativar, bloquear ou excluir no Zitadel
 * inativa a pessoa aqui e devolve os chamados abertos dela à fila. Nunca loga o corpo.
 */
@Injectable()
export class ZitadelEventsService {
  private readonly logger = new Logger(ZitadelEventsService.name);
  private readonly signingKey: string | undefined;

  constructor(
    private readonly users: UsersService,
    private readonly tickets: TicketsService,
    private readonly cache: UserCache,
    config: ConfigService<Env, true>,
  ) {
    this.signingKey = config.get('ZITADEL_ACTIONS_SIGNING_KEY', { infer: true });
  }

  async handle(rawBody: Buffer | undefined, signature: string | undefined) {
    // RN-02: sem chave, a integração está desligada.
    if (!this.signingKey) {
      throw new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Rota não encontrada.');
    }
    const body = rawBody ?? Buffer.alloc(0);
    if (!verifyZitadelSignature(signature, body, this.signingKey)) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ApiErrorCode.INVALID_SIGNATURE,
        'Assinatura inválida.',
      );
    }
    const event = this.parse(body);
    if (event.aggregateType !== 'user' || !DEACTIVATING_EVENTS.has(event.event_type)) {
      return { handled: false };
    }

    const user = await this.users.deactivateBySub(event.aggregateID);
    if (!user) return { handled: false };
    // RN-05: o 403 USER_INACTIVE vale já na próxima requisição, mesmo com token válido.
    this.cache.invalidate(event.aggregateID);
    const released = await this.tickets.releaseAssignedTickets(user.id);
    this.logger.log(
      `Zitadel ${event.event_type}: usuário ${user.id} ${user.changed ? 'desativado' : 'já estava inativo'}; ${released} chamado(s) devolvido(s) à fila`,
    );
    return { handled: true };
  }

  /** RN-03: corpo que não é JSON ou sem os campos → 400. */
  private parse(body: Buffer): z.infer<typeof zitadelEventSchema> {
    let json: unknown;
    try {
      json = JSON.parse(body.toString('utf8'));
    } catch {
      json = null;
    }
    const parsed = zitadelEventSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.VALIDATION_ERROR,
        'Evento do Zitadel inválido.',
      );
    }
    return parsed.data;
  }
}
