import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isSatisfactionScore,
  type SatisfactionRateData,
  type SatisfactionScore,
  type TicketSatisfaction,
} from '@helpdesk/shared';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashSurveyToken, newSurveyToken } from './survey-token.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Avaliação por um link válido (RN-13). */
export interface SurveyRecord {
  ticketId: string;
  score: SatisfactionScore | null;
  comment: string | null;
  ratedAt: Date | null;
  expiresAt: Date;
}

/** O que os relatórios leem de cada chamado (T40 RN-19 a RN-21). */
export interface SatisfactionRow {
  ticketId: string;
  score: SatisfactionScore | null;
  comment: string | null;
  ratedAt: Date | null;
  requestedAt: Date;
}

const score = (value: number | null): SatisfactionScore | null =>
  isSatisfactionScore(value) ? value : null;

/**
 * T40: dono da tabela `ticket_satisfaction` — o link de avaliação de cada chamado (só o hash) e a
 * última avaliação. Nunca loga token nem hash (RN-14).
 */
@Injectable()
export class SatisfactionService {
  private readonly days: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.days = config.get('CSAT_LINK_DAYS', { infer: true });
  }

  /** Validade do link em dias; `0` = pesquisa desligada (RN-05). */
  get linkDays(): number {
    return this.days;
  }

  /**
   * RN-04 e RN-05: link novo para a resolução, na transação dela; o anterior deixa de valer.
   * A avaliação já dada continua (RN-18). Com a pesquisa desligada, só invalida e devolve `null`.
   */
  async issueLink(
    tx: Prisma.TransactionClient,
    ticketId: string,
    now = new Date(),
  ): Promise<string | null> {
    if (this.days === 0) {
      await this.revokeLink(tx, ticketId);
      return null;
    }
    const { token, hash } = newSurveyToken();
    const link = {
      tokenHash: hash,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + this.days * DAY_MS),
    };
    await tx.ticketSatisfaction.upsert({
      where: { ticketId },
      create: { ticketId, ...link },
      update: link,
    });
    return token;
  }

  /** RN-04: resolução que não mandou e-mail ao solicitante. Sem linha, nada a fazer. */
  async revokeLink(tx: Prisma.TransactionClient, ticketId: string): Promise<void> {
    await tx.ticketSatisfaction.updateMany({
      where: { ticketId, tokenHash: { not: null } },
      data: { tokenHash: null, expiresAt: null },
    });
  }

  /** RN-05 e RN-13: o link atual, dentro do prazo e com a pesquisa ligada; senão `null`. */
  async findByToken(token: string, now = new Date()): Promise<SurveyRecord | null> {
    if (this.days === 0) return null;
    const row = await this.prisma.ticketSatisfaction.findUnique({
      where: { tokenHash: hashSurveyToken(token) },
      select: { ticketId: true, score: true, comment: true, ratedAt: true, expiresAt: true },
    });
    if (!row?.expiresAt || row.expiresAt <= now) return null;
    return {
      ticketId: row.ticketId,
      score: score(row.score),
      comment: row.comment,
      ratedAt: row.ratedAt,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * RN-10, RN-11 e RN-15: grava (ou substitui) a avaliação. A condição pelo hash e pelo prazo vai
   * no próprio UPDATE: se uma resolução trocou o link no meio, nada é gravado.
   */
  async rate(
    token: string,
    input: SatisfactionRateData,
    now = new Date(),
  ): Promise<SurveyRecord | null> {
    if (this.days === 0) return null;
    const { count } = await this.prisma.ticketSatisfaction.updateMany({
      where: { tokenHash: hashSurveyToken(token), expiresAt: { gt: now } },
      data: { score: input.score, comment: input.comment, ratedAt: now },
    });
    if (count === 0) return null;
    return this.findByToken(token, now);
  }

  /** RN-16 e RN-17: o bloco do painel do chamado (quem chama já conferiu o papel). */
  async forTicket(ticketId: string, now = new Date()): Promise<TicketSatisfaction | null> {
    const row = await this.prisma.ticketSatisfaction.findUnique({
      where: { ticketId },
      select: {
        score: true,
        comment: true,
        ratedAt: true,
        requestedAt: true,
        tokenHash: true,
        expiresAt: true,
      },
    });
    if (!row) return null;
    return {
      score: score(row.score),
      comment: row.comment,
      ratedAt: row.ratedAt?.toISOString() ?? null,
      requestedAt: row.requestedAt.toISOString(),
      linkActive:
        this.days > 0 && row.tokenHash !== null && row.expiresAt !== null && row.expiresAt > now,
    };
  }

  /** RN-19: avaliações dadas no período ou links enviados no período. */
  async forReport(start: Date, end: Date): Promise<SatisfactionRow[]> {
    const range = { gte: start, lt: end };
    const rows = await this.prisma.ticketSatisfaction.findMany({
      where: { OR: [{ ratedAt: range }, { requestedAt: range }] },
      select: { ticketId: true, score: true, comment: true, ratedAt: true, requestedAt: true },
    });
    return rows.map((row) => ({ ...row, score: score(row.score) }));
  }
}
