import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const NOTIFICATION_TEMPLATES = [
  'ticket_created',
  'ticket_created_group',
  'reply',
  'requester_reply',
  'resolved',
  // T22 (RN-16 a RN-18): avisos sem ticket, da liberação de acesso.
  'access_request_created',
  'access_granted',
] as const;

export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

/** RN-17: `Auto-Submitted` nos automáticos; o `reply` traz o texto de uma pessoa. */
export const AUTO_SUBMITTED: Record<NotificationTemplate, boolean> = {
  ticket_created: true,
  ticket_created_group: true,
  reply: false,
  requester_reply: true,
  resolved: true,
  access_request_created: true,
  access_granted: true,
};

/** Assunto fixo dos templates sem ticket (T22 RN-16, RN-17): sem `[#n]`. */
const SYSTEM_SUBJECT: Partial<Record<NotificationTemplate, string>> = {
  access_request_created: 'Novo pedido de acesso ao help desk',
  access_granted: 'Seu acesso ao help desk foi liberado',
};

const payloadAttachment = z.object({
  filename: z.string(),
  storageKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});

/**
 * RN-10: tudo que o template precisa, congelado no enqueue. Lido de volta do `jsonb` com o
 * schema, para não confiar no formato gravado.
 */
export const notificationPayload = z.object({
  /** `null` nos templates sem ticket (T22: `access_request_created`, `access_granted`). */
  ticketId: z.string().nullable(),
  ticketNumber: z.number().nullable(),
  ticketSubject: z.string().nullable(),
  recipientName: z.string(),
  /** Link do ticket no portal; `null` para quem não faz login (RN-07). */
  portalUrl: z.string().nullable(),
  authorName: z.string(),
  /** Corpo da mensagem, já sanitizado na gravação. `null` no `resolved`. */
  bodyHtml: z.string().nullable(),
  attachments: z.array(payloadAttachment),
  resolved: z.boolean(),
  groupName: z.string().nullable(),
  requesterName: z.string(),
  /** Só em `access_request_created` (T22 RN-16). */
  requesterEmail: z.string().nullable().optional(),
  companyName: z.string().nullable(),
  categoryName: z.string().nullable(),
});

export type NotificationPayload = z.infer<typeof notificationPayload>;
export type PayloadAttachment = z.infer<typeof payloadAttachment>;

/** Quem recebe um aviso sem ticket (T22). */
export interface SystemNotificationRecipient {
  email: string;
  name: string;
}

/**
 * Payload de um aviso sem ticket (T22, RN-16 a RN-18): pedido de acesso novo ou liberação.
 * Quem grava a linha na outbox (`UsersService`) monta este payload sem depender do
 * `NotificationService` — só o `processOutbox` (aqui mesmo) sabe como entregá-lo.
 */
export function systemNotificationPayload(
  recipientName: string,
  portalUrl: string,
  data: { requesterName?: string; requesterEmail?: string } = {},
): NotificationPayload {
  return {
    ticketId: null,
    ticketNumber: null,
    ticketSubject: null,
    recipientName,
    portalUrl,
    authorName: '',
    bodyHtml: null,
    attachments: [],
    resolved: false,
    groupName: null,
    requesterName: data.requesterName ?? '',
    requesterEmail: data.requesterEmail ?? null,
    companyName: null,
    categoryName: null,
  };
}

/** Message-ID de um aviso sem ticket (T22): prefixo `sys-`, nunca `tk-`. */
export function systemEmailMessageId(domain: string): string {
  return `<sys-${randomUUID()}@${domain}>`;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

type Block = { kind: 'text'; value: string } | { kind: 'message'; html: string };

const text = (value: string): Block => ({ kind: 'text', value });

const REPLY_LINE = 'Responda este e-mail para continuar o atendimento.';

/**
 * RN-16 e RN-18. `attached`: os anexos foram junto no e-mail; senão, só os nomes aparecem
 * no corpo (RN-19).
 */
export function renderNotification(
  template: NotificationTemplate,
  payload: NotificationPayload,
  attached: boolean,
): RenderedMail {
  const blocks = [...intro(template, payload)];
  if (payload.bodyHtml) blocks.push({ kind: 'message', html: payload.bodyHtml });
  if (payload.attachments.length > 0 && !attached) {
    const names = payload.attachments.map((a) => a.filename).join(', ');
    blocks.push(
      text(
        payload.portalUrl
          ? `Anexos (grandes demais para o e-mail, disponíveis no portal): ${names}.`
          : `Anexos (grandes demais para o e-mail): ${names}.`,
      ),
    );
  }
  if (template === 'reply' && payload.resolved) {
    blocks.push(
      text(
        'Marcamos este chamado como resolvido. Se ainda precisar de ajuda, é só responder este e-mail.',
      ),
    );
  }
  // RN-18: avisos sem ticket não são conversas — nada para responder.
  if (payload.ticketNumber !== null) blocks.push(text(REPLY_LINE));

  return {
    subject:
      payload.ticketNumber !== null
        ? `[#${payload.ticketNumber}] ${payload.ticketSubject}`
        : (SYSTEM_SUBJECT[template] ?? template),
    html: toHtml(blocks, payload.portalUrl),
    text: toText(blocks, payload.portalUrl),
  };
}

function intro(template: NotificationTemplate, p: NotificationPayload): Block[] {
  const ticket = `#${p.ticketNumber} — ${p.ticketSubject}`;
  switch (template) {
    case 'ticket_created':
      return [
        text(`Olá, ${p.recipientName}.`),
        text(
          `Recebemos o seu chamado ${ticket}. A equipe de suporte vai responder por este e-mail.`,
        ),
      ];
    case 'ticket_created_group':
      return [
        text(`Novo chamado na fila ${p.groupName ?? ''}: ${ticket}.`),
        text(
          [
            `Solicitante: ${p.requesterName}`,
            `Unidade: ${p.companyName ?? 'sem unidade'}`,
            `Categoria: ${p.categoryName ?? '—'}`,
          ].join(' · '),
        ),
      ];
    case 'reply':
      return [
        text(`Olá, ${p.recipientName}.`),
        text(`${p.authorName} respondeu ao seu chamado ${ticket}:`),
      ];
    case 'requester_reply':
      return [text(`${p.requesterName} respondeu no chamado ${ticket}:`)];
    case 'access_request_created':
      return [
        text('Novo pedido de acesso ao help desk.'),
        text([`Nome: ${p.requesterName}`, `E-mail: ${p.requesterEmail ?? '—'}`].join(' · ')),
      ];
    case 'access_granted':
      return [
        text(`Olá, ${p.recipientName}.`),
        text(
          'Seu acesso ao help desk foi liberado. Você já pode abrir e acompanhar chamados pelo portal.',
        ),
      ];
    default: // resolved
      return [
        text(`Olá, ${p.recipientName}.`),
        text(`O seu chamado ${ticket} foi marcado como resolvido.`),
        text('Se o problema continuar, responda este e-mail e o chamado será reaberto.'),
      ];
  }
}

const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222';

function toHtml(blocks: Block[], portalUrl: string | null): string {
  const parts = blocks.map((block) =>
    block.kind === 'text'
      ? `<p style="margin:0 0 12px">${escapeHtml(block.value)}</p>`
      : `<div style="margin:0 0 12px;padding:12px;border-left:3px solid #ccc;background:#f7f7f7">${block.html}</div>`,
  );
  if (portalUrl) {
    const href = escapeHtml(portalUrl);
    parts.push(
      `<p style="margin:0 0 12px">Ou acompanhe pelo portal: <a href="${href}">${href}</a></p>`,
    );
  }
  parts.push(
    '<p style="margin:16px 0 0;font-size:12px;color:#777">Suporte MSMT — Missão Salesiana de Mato Grosso</p>',
  );
  return `<!doctype html><html lang="pt-BR"><body style="${FONT}">${parts.join('')}</body></html>`;
}

function toText(blocks: Block[], portalUrl: string | null): string {
  const parts = blocks.map((block) =>
    block.kind === 'text' ? block.value : htmlToText(block.html),
  );
  if (portalUrl) parts.push(`Ou acompanhe pelo portal: ${portalUrl}`);
  parts.push('--\nSuporte MSMT — Missão Salesiana de Mato Grosso');
  return `${parts.join('\n\n')}\n`;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Versão texto do HTML já sanitizado (allowlist pequena): quebras nos blocos, sem tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
