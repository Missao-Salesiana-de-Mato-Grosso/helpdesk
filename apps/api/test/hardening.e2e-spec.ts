// T18 (docs/discovery/05-plano-mvp.md): headers de segurança, limite por IP e erros sem stack.
// Os logs ficam em logging.e2e-spec.ts.
import { Controller, Get } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import { ApiErrorCode } from '@helpdesk/shared';
import request from 'supertest';
import { Public } from '../src/auth/decorators.js';
import { createTestApp, TEST_ISSUER, type TestApp } from './setup/auth.js';

@Controller('test-hardening')
class FailingController {
  @Get('boom')
  @Public()
  boom(): never {
    throw new Error('segredo-no-stack');
  }
}

describe('hardening — T18 (e2e)', () => {
  describe('headers e erros', () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await createTestApp({ controllers: [FailingController] });
    });

    afterAll(async () => {
      await t.app.close();
    });

    it('sends a restrictive CSP and the helmet headers', async () => {
      const res = await request(t.app.getHttpServer()).get('/api/health').expect(200);
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain(`connect-src 'self' ${TEST_ISSUER}`);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      // Fora de produção não força https (o Zitadel local é http).
      expect(csp).not.toContain('upgrade-insecure-requests');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('sends the CSP on error responses too', async () => {
      const res = await request(t.app.getHttpServer()).get('/api/tickets').expect(401);
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('answers an unexpected error without stack or internal message', async () => {
      const res = await request(t.app.getHttpServer()).get('/api/test-hardening/boom').expect(500);
      expect(res.body).toEqual({
        statusCode: 500,
        code: ApiErrorCode.INTERNAL_ERROR,
        message: 'Erro interno.',
      });
      expect(res.text).not.toContain('segredo-no-stack');
      expect(res.text).not.toMatch(/\bat \w+/);
    });

    it('answers malformed JSON with 400 and no stack', async () => {
      const res = await request(t.app.getHttpServer())
        .post('/api/tickets')
        .set('Content-Type', 'application/json')
        .send('{"subject":')
        .expect(400);
      expect(res.text).not.toMatch(/\bat \w+/);
      expect(res.text).not.toContain('node_modules');
    });
  });

  describe('limite por IP', () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await createTestApp({
        providers: [
          { provide: getOptionsToken(), useValue: { throttlers: [{ ttl: 60_000, limit: 3 }] } },
        ],
      });
    });

    afterAll(async () => {
      await t.app.close();
    });

    it('returns 429 RATE_LIMITED once the limit is reached, before authentication', async () => {
      const server = t.app.getHttpServer();
      for (let i = 0; i < 3; i++) await request(server).get('/api/tickets').expect(401);
      const res = await request(server).get('/api/tickets').expect(429);
      expect(res.body).toMatchObject({ statusCode: 429, code: ApiErrorCode.RATE_LIMITED });
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('never limits the health check (Kubernetes probes)', async () => {
      for (let i = 0; i < 5; i++)
        await request(t.app.getHttpServer()).get('/api/health').expect(200);
    });
  });
});
