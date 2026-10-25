import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { serveSpa } from './spa.js';

@Controller('health')
class HealthStubController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}

function buildDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spa-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  return dir;
}

let app: NestExpressApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthStubController],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  nest.setGlobalPrefix('api');
  serveSpa(nest, buildDist());
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('serveSpa', () => {
  it('serve os assets com hash com cache imutável', async () => {
    const response = await request(app.getHttpServer()).get('/assets/index-abc123.js');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serve outros arquivos estáticos sem cache longo', async () => {
    const response = await request(app.getHttpServer()).get('/favicon.svg');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it.each(['/', '/tickets/1042', '/auth/callback'])(
    'rota do front %s devolve o index.html sem cache',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(200);
      expect(response.text).toContain('id="root"');
      expect(response.headers['cache-control']).toBe('no-cache');
    },
  );

  it('não intercepta a API', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/api/health')).body).toEqual({ status: 'ok' });
    const missing = await request(server).get('/api/nao-existe');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('id="root"');
  });

  it('não devolve o index.html para métodos que não são GET', async () => {
    const response = await request(app.getHttpServer()).post('/tickets');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('id="root"');
  });

  it('falha na subida se a pasta não tiver index.html', () => {
    expect(() => serveSpa(app, mkdtempSync(join(tmpdir(), 'spa-vazio-')))).toThrow(/index.html/);
  });
});
