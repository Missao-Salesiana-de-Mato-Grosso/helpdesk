import type { ReportRate, ReportRow } from '@helpdesk/shared';

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
    ]
      .map(cell)
      .join(';'),
  );
  return `﻿${[header.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
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
