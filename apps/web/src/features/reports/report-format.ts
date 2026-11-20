import {
  SATISFACTION_LABELS,
  isSatisfactionScore,
  type ReportRate,
  type ReportRow,
  type ReportSatisfaction,
  type SatisfactionReportItem,
} from '@helpdesk/shared';

/** Spec T37 RN-08: minutos úteis como `Xd Yh`, `Xh Ymin` ou `Ymin`; sem valor, "—". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
  return `${rest}min`;
}

/** RN-11: percentual inteiro, ou "—" sem avaliados. */
export function formatRate(rate: ReportRate): string {
  if (rate.evaluated === 0) return '—';
  return `${Math.round((rate.met / rate.evaluated) * 100)}%`;
}

/** T40 RN-19: % de satisfeitos (notas 4 e 5), ou "—" sem avaliação. */
export function formatSatisfaction(satisfaction: ReportSatisfaction): string {
  if (satisfaction.responses === 0) return '—';
  return `${Math.round((satisfaction.satisfied / satisfaction.responses) * 100)}%`;
}

/** Média com uma casa e vírgula (`4,5`), ou "—". */
export const formatAverage = (average: number | null): string =>
  average === null ? '—' : average.toFixed(1).replace('.', ',');

/** T40 RN-19: dos links enviados no período, quantos foram respondidos. */
export function formatResponseRate(satisfaction: ReportSatisfaction): string {
  if (satisfaction.requested === 0) return '—';
  return `${Math.round((satisfaction.answered / satisfaction.requested) * 100)}%`;
}

/** "4 — Satisfeito". */
export const scoreText = (score: number): string =>
  isSatisfactionScore(score) ? `${score} — ${SATISFACTION_LABELS[score]}` : String(score);

const pad = (n: number) => String(n).padStart(2, '0');
/** Data local do navegador como `AAAA-MM-DD`. */
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export type ReportPreset = '7d' | '30d' | 'month' | 'lastMonth';

export const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'month', label: 'Mês atual' },
  { value: 'lastMonth', label: 'Mês anterior' },
];

/** RN-02: período de cada atalho, contando hoje. */
export function presetRange(preset: ReportPreset, today: Date): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const daysAgo = (n: number) => new Date(y, m, today.getDate() - n);
  switch (preset) {
    case '7d':
      return { from: isoDay(daysAgo(6)), to: isoDay(today) };
    case 'month':
      return { from: isoDay(new Date(y, m, 1)), to: isoDay(today) };
    case 'lastMonth':
      return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
    default:
      return { from: isoDay(daysAgo(29)), to: isoDay(today) };
  }
}

const percent = (rate: ReportRate) =>
  rate.evaluated === 0 ? '' : ((rate.met / rate.evaluated) * 100).toFixed(1).replace('.', ',');

const cell = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * RN-16: CSV para o Excel em pt-BR — BOM, `;`, tempos em minutos úteis inteiros e percentual com
 * vírgula.
 */
export function reportCsv(label: string, rows: readonly ReportRow[]): string {
  const header = [
    label,
    'Criados',
    'Resolvidos',
    'Fechados',
    '1ª resposta (mediana, min úteis)',
    'Resolução (mediana, min úteis)',
    '1ª resposta no prazo (%)',
    'Resolução no prazo (%)',
    // T40 RN-20.
    'Avaliações',
    'Satisfeitos (notas 4 e 5)',
    'Satisfação média',
  ];
  const lines = rows.map((row) =>
    [
      row.active ? row.name : `${row.name} (inativo)`,
      row.created,
      row.resolved,
      row.closed,
      row.firstResponse.median,
      row.resolution.median,
      percent(row.firstResponseSla),
      percent(row.resolutionSla),
      row.satisfaction.responses,
      row.satisfaction.satisfied,
      row.satisfaction.average === null ? '' : formatAverage(row.satisfaction.average),
    ]
      .map(cell)
      .join(';'),
  );
  return csvText(header, lines);
}

/** BOM, cabeçalho e linhas separadas por CRLF (RN-16). */
const csvText = (header: readonly string[], lines: readonly string[]) =>
  `﻿${[header.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Cuiaba',
});

/** T40 RN-21: a lista de avaliações, no mesmo formato da T37 RN-16. */
export function satisfactionCsv(items: readonly SatisfactionReportItem[]): string {
  const header = [
    'Chamado',
    'Assunto',
    'Nota',
    'Comentário',
    'Responsável',
    'Grupo',
    'Avaliado em',
  ];
  const lines = items.map((item) =>
    [
      item.ticketNumber,
      item.ticketSubject,
      item.score,
      item.comment ?? '',
      item.assignee?.name ?? '',
      item.group.name,
      DATE_TIME.format(new Date(item.ratedAt)),
    ]
      .map(cell)
      .join(';'),
  );
  return csvText(header, lines);
}

/** Baixa o texto como arquivo, sem rota nova (RN-16). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
