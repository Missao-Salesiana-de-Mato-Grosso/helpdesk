import { useEffect, useState } from 'react';
import type { SlaState, SlaTarget, TicketSla } from '@helpdesk/shared';

export const SLA_COLOR: Record<SlaState, string> = {
  met: 'green',
  breached: 'red',
  at_risk: 'orange',
  running: 'gray',
  paused: 'gray',
};

/** "45 min", "3 h", "2 dias". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} dias`;
}

export function slaText(
  state: SlaState,
  target: SlaTarget,
  pausedAt: string | null,
  now: Date,
): string {
  const due = Date.parse(target.dueAt);
  if (state === 'met') return 'No prazo';
  if (state === 'paused') return 'Pausado';
  if (state === 'breached') {
    if (target.doneAt !== null) return 'Fora do prazo';
    return pausedAt === null ? `Vencido há ${formatDuration(now.getTime() - due)}` : 'Vencido';
  }
  return `Vence em ${formatDuration(due - now.getTime())}`;
}

/** Meta que importa agora: a 1ª resposta enquanto não houver, depois a resolução. */
export function currentTarget(sla: TicketSla): { label: string; target: SlaTarget } | null {
  if (sla.firstResponse && sla.firstResponse.doneAt === null) {
    return { label: '1ª resposta', target: sla.firstResponse };
  }
  if (sla.resolution) return { label: 'Resolução', target: sla.resolution };
  return null;
}

/** Hora atual, renovada a cada 30 s (o mesmo ritmo do polling das filas). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
