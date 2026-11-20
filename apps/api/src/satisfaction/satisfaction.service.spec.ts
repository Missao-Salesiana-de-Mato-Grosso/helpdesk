// Spec docs/specs/T40-csat.md — validade do link e pesquisa desligada (sem banco).
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SatisfactionService } from './satisfaction.service.js';
import { hashSurveyToken } from './survey-token.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function setup(days: number) {
  const table = {
    upsert: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn(),
  };
  const prisma = { ticketSatisfaction: table };
  const config = { get: () => days };
  const service = new SatisfactionService(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dublê só com o que o service usa.
    prisma as unknown as PrismaService,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- idem.
    config as unknown as ConfigService<Env, true>,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- idem.
  const tx = prisma as unknown as Prisma.TransactionClient;
  return { service, table, tx };
}

describe('SatisfactionService (T40)', () => {
  it('CT-01 / RN-05 link novo vale CSAT_LINK_DAYS dias; grava só o hash', async () => {
    const { service, table, tx } = setup(30);
    const token = await service.issueLink(tx, 't1', NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const call = table.upsert.mock.calls[0]?.[0];
    expect(call.where).toEqual({ ticketId: 't1' });
    expect(call.update).toEqual({
      tokenHash: hashSurveyToken(token!),
      requestedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
    });
    // RN-18: a avaliação já dada não é tocada.
    expect(call.update).not.toHaveProperty('score');
  });

  it('CT-07 / RN-05 com CSAT_LINK_DAYS=0: nenhum link novo, o anterior é invalidado e nada vale', async () => {
    const { service, table, tx } = setup(0);
    expect(await service.issueLink(tx, 't1', NOW)).toBeNull();
    expect(table.upsert).not.toHaveBeenCalled();
    expect(table.updateMany).toHaveBeenCalledWith({
      where: { ticketId: 't1', tokenHash: { not: null } },
      data: { tokenHash: null, expiresAt: null },
    });
    expect(await service.findByToken('abc', NOW)).toBeNull();
    expect(await service.rate('abc', { token: 'abc', score: 5, comment: null }, NOW)).toBeNull();
    expect(table.findUnique).not.toHaveBeenCalled();
  });

  it('CT-07 / RN-05 link vencido não vale', async () => {
    const { service, table } = setup(30);
    table.findUnique.mockResolvedValue({
      ticketId: 't1',
      score: null,
      comment: null,
      ratedAt: null,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(await service.findByToken('abc', NOW)).toBeNull();
    table.findUnique.mockResolvedValue({
      ticketId: 't1',
      score: 4,
      comment: null,
      ratedAt: null,
      expiresAt: new Date(NOW.getTime() + 1),
    });
    expect(await service.findByToken('abc', NOW)).toMatchObject({ ticketId: 't1', score: 4 });
  });
});
