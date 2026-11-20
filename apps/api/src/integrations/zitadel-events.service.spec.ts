// Spec docs/specs/T39-desligamento-zitadel.md — integração desligada sem a chave.
import type { ConfigService } from '@nestjs/config';
import type { UserCache } from '../auth/user-cache.js';
import { ApiException } from '../common/api-exception.js';
import type { Env } from '../config/env.js';
import type { TicketsService } from '../tickets/tickets.service.js';
import type { UsersService } from '../users/users.service.js';
import { ZitadelEventsService } from './zitadel-events.service.js';

/** Dublês: o teste não pode chegar a usar nenhum deles. */
function service(signingKey: string | undefined) {
  const users = { deactivateBySub: vi.fn() };
  const config = { get: () => signingKey };
  return {
    users,
    events: new ZitadelEventsService(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      users as unknown as UsersService,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      {} as TicketsService,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      {} as UserCache,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      config as unknown as ConfigService<Env, true>,
    ),
  };
}

describe('ZitadelEventsService (T39)', () => {
  it('CT-03 sem ZITADEL_ACTIONS_SIGNING_KEY a rota não existe (404)', async () => {
    const { events, users } = service(undefined);
    const error = await events
      .handle(Buffer.from('{}'), 't=1,v1=00')
      .catch((caught: unknown) => caught);
    if (!(error instanceof ApiException)) throw new Error('esperava ApiException');
    expect(error.getStatus()).toBe(404);
    expect(users.deactivateBySub).not.toHaveBeenCalled();
  });
});
