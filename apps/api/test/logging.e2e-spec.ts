// T18 (docs/discovery/05-plano-mvp.md): log sem `Authorization` nem corpo de mensagem.
// Arquivo próprio: o nestjs-pino guarda um único pino-http por processo (o da primeira app criada),
// e o Vitest isola o estado dos módulos por arquivo. A app daqui precisa ser a primeira.
import { Writable } from 'node:stream';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import { loggerParams } from '../src/common/logger.js';
import { hashSurveyToken } from '../src/satisfaction/survey-token.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture } from './setup/tickets-fixture.js';

describe('logs — T18 (e2e)', () => {
  let t: TestApp;
  let lines: string[];

  beforeAll(async () => {
    lines = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    t = await createTestApp({
      providers: [
        {
          provide: PARAMS_PROVIDER_TOKEN,
          useValue: loggerParams({ LOG_LEVEL: 'info' }, destination),
        },
      ],
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
  });

  it('logs the request without Authorization, token or message body', async () => {
    const f = await createTicketsFixture(t);
    const token = await f.token('req1');
    const secret = 'corpo-sigiloso-da-mensagem';
    await request(t.app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', 'session=biscoito-secreto')
      .send({ subject: 'Assunto', bodyHtml: `<p>${secret}</p>`, categoryId: f.C1 })
      .expect(201);

    const output = lines.join('');
    // A linha da requisição saiu (o teste não passa por falta de log).
    expect(output).toMatch(/"url":"\/api\/tickets".*"statusCode":201/);
    expect(output).not.toContain(token);
    expect(output).not.toContain(secret);
    expect(output).not.toContain('biscoito-secreto');
    expect(output.toLowerCase()).not.toContain('authorization');
  });

  it('T40 CT-15 não loga o token da avaliação nem o hash dele', async () => {
    const f = await createTicketsFixture(t);
    const server = t.app.getHttpServer();
    const ticket = await f.ticket({ requester: 'req1' });
    await request(server)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${await f.token('ag1')}`)
      .send({ version: 1, status: 'resolved' })
      .expect(200);
    const notification = await t.prisma.notification.findFirstOrThrow({
      where: { ticketId: ticket.id },
    });
    const payload: unknown = notification.payload;
    const url =
      payload && typeof payload === 'object' && 'csatUrl' in payload ? payload.csatUrl : null;
    if (typeof url !== 'string') throw new Error('Sem link de avaliação');
    const token = url.slice(url.indexOf('#') + 1);
    lines.length = 0;

    await request(server).post('/api/satisfaction/lookup').send({ token }).expect(200);
    await request(server).put('/api/satisfaction').send({ token, score: 5 }).expect(200);

    const output = lines.join('');
    expect(output).toMatch(/"url":"\/api\/satisfaction".*"statusCode":200/);
    expect(output).not.toContain(token);
    expect(output).not.toContain(hashSurveyToken(token));
  });
});
