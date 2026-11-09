import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiErrorCode,
  TICKET_PRIORITIES,
  type BusinessInterval,
  type CreateHolidayInput,
  type Holiday,
  type SlaPolicy,
  type SlaSettings,
  type TicketPriority,
  type TicketStatus,
  type UpdateBusinessHoursInput,
  type UpdateSlaPoliciesInput,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { isUuid } from '../common/uuid.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessCalendar,
} from './business-time.js';

/** Status em que o relógio do SLA para: a espera é do solicitante, ou o atendimento acabou. */
const PAUSED: ReadonlySet<TicketStatus> = new Set(['pending', 'resolved', 'closed']);

/** Metas e calendário carregados uma vez por operação. */
export interface SlaContext {
  calendar: BusinessCalendar;
  policies: ReadonlyMap<TicketPriority, SlaPolicy>;
}

export interface SlaDueDates {
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

/** Colunas de SLA do ticket. */
export interface SlaFields extends SlaDueDates {
  slaPausedAt: Date | null;
  slaPausedMinutes: number;
}

/** O que o cálculo precisa do ticket. */
export interface SlaClock {
  createdAt: Date;
  priority: TicketPriority;
  status: TicketStatus;
  slaPausedAt: Date | null;
  slaPausedMinutes: number;
}

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const priorityOrder = (priority: TicketPriority) => TICKET_PRIORITIES.indexOf(priority);

const holidayNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Feriado não encontrado.');

/**
 * T28: metas por prioridade, horário comercial e feriados, e o cálculo dos prazos. Só lê e grava as
 * próprias tabelas; quem grava os prazos no ticket é o TicketsService.
 */
@Injectable()
export class SlaService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.timeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async context(): Promise<SlaContext> {
    const [policies, intervals, holidays] = await Promise.all([
      this.prisma.slaPolicy.findMany(),
      this.prisma.businessHours.findMany({
        select: { weekday: true, startMinute: true, endMinute: true },
      }),
      this.prisma.holiday.findMany({ select: { date: true } }),
    ]);
    return {
      calendar: {
        timeZone: this.timeZone,
        intervals,
        holidays: new Set(holidays.map((holiday) => dateOnly(holiday.date))),
      },
      policies: new Map(policies.map((policy) => [policy.priority, policy])),
    };
  }

  /** Prazos a partir da abertura, somado o tempo pausado. Sem meta ou sem horário útil: nulos. */
  dueDates(
    context: SlaContext,
    clock: Pick<SlaClock, 'createdAt' | 'priority' | 'slaPausedMinutes'>,
  ): SlaDueDates {
    const policy = context.policies.get(clock.priority);
    if (!policy || context.calendar.intervals.length === 0) {
      return { firstResponseDueAt: null, resolutionDueAt: null };
    }
    const due = (minutes: number) =>
      addBusinessMinutes(clock.createdAt, minutes + clock.slaPausedMinutes, context.calendar);
    return {
      firstResponseDueAt: due(policy.firstResponseMinutes),
      resolutionDueAt: due(policy.resolutionMinutes),
    };
  }

  /** SLA de um ticket novo (sempre aberto: o relógio começa correndo). */
  async initial(priority: TicketPriority, createdAt: Date): Promise<SlaFields> {
    const context = await this.context();
    return {
      ...this.dueDates(context, { createdAt, priority, slaPausedMinutes: 0 }),
      slaPausedAt: null,
      slaPausedMinutes: 0,
    };
  }

  /**
   * Efeito de uma mudança de status ou prioridade. Entrar numa pausa marca o início; sair dela soma
   * os minutos úteis pausados e empurra os prazos. Devolve só o que muda (`{}` se nada).
   */
  async plan(
    clock: SlaClock,
    next: { status: TicketStatus; priority: TicketPriority },
    now: Date,
  ): Promise<Partial<SlaFields>> {
    const wasPaused = PAUSED.has(clock.status);
    const isPaused = PAUSED.has(next.status);
    const priorityChanged = next.priority !== clock.priority;
    if (wasPaused === isPaused && !priorityChanged) return {};

    const context = await this.context();
    const changes: Partial<SlaFields> = {};
    let pausedMinutes = clock.slaPausedMinutes;
    if (!wasPaused && isPaused) changes.slaPausedAt = now;
    if (wasPaused && !isPaused) {
      if (clock.slaPausedAt) {
        pausedMinutes += businessMinutesBetween(clock.slaPausedAt, now, context.calendar);
      }
      changes.slaPausedAt = null;
      changes.slaPausedMinutes = pausedMinutes;
    }
    if (priorityChanged || pausedMinutes !== clock.slaPausedMinutes) {
      Object.assign(
        changes,
        this.dueDates(context, {
          ...clock,
          priority: next.priority,
          slaPausedMinutes: pausedMinutes,
        }),
      );
    }
    return changes;
  }

  // ── administração ─────────────────────────────────────────────────────────

  async settings(): Promise<SlaSettings> {
    const [policies, hours] = await Promise.all([
      this.prisma.slaPolicy.findMany({
        select: { priority: true, firstResponseMinutes: true, resolutionMinutes: true },
      }),
      this.prisma.businessHours.findMany({
        select: { weekday: true, startMinute: true, endMinute: true },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
    ]);
    return {
      timeZone: this.timeZone,
      // Urgente primeiro, como na tela.
      policies: policies.toSorted((a, b) => priorityOrder(b.priority) - priorityOrder(a.priority)),
      hours,
    };
  }

  async updatePolicies(input: UpdateSlaPoliciesInput): Promise<void> {
    await this.prisma.$transaction(
      input.map(({ priority, firstResponseMinutes, resolutionMinutes }) =>
        this.prisma.slaPolicy.upsert({
          where: { priority },
          update: { firstResponseMinutes, resolutionMinutes },
          create: { priority, firstResponseMinutes, resolutionMinutes },
        }),
      ),
    );
  }

  async updateHours(input: UpdateBusinessHoursInput): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.businessHours.deleteMany(),
      this.prisma.businessHours.createMany({ data: input satisfies BusinessInterval[] }),
    ]);
  }

  async listHolidays(): Promise<Holiday[]> {
    const rows = await this.prisma.holiday.findMany({
      select: { id: true, date: true, name: true },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => ({ ...row, date: dateOnly(row.date) }));
  }

  async createHoliday(input: CreateHolidayInput): Promise<Holiday> {
    try {
      const row = await this.prisma.holiday.create({
        data: { date: new Date(`${input.date}T00:00:00Z`), name: input.name },
        select: { id: true, date: true, name: true },
      });
      return { ...row, date: dateOnly(row.date) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ApiErrorCode.DATE_TAKEN,
          'Já existe um feriado nesta data.',
        );
      }
      throw error;
    }
  }

  async deleteHoliday(id: string): Promise<void> {
    if (!isUuid(id)) throw holidayNotFound();
    const { count } = await this.prisma.holiday.deleteMany({ where: { id } });
    if (count === 0) throw holidayNotFound();
  }
}
