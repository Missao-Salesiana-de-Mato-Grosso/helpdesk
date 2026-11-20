import { randomUUID } from 'node:crypto';
import { SATISFACTION_LABELS, SATISFACTION_SCORES } from '@helpdesk/shared';
import { z } from 'zod';
import { surveyScoreUrl } from '../satisfaction/survey-token.js';

export const NOTIFICATION_TEMPLATES = [
  'ticket_created',
  'ticket_created_group',
  'reply',
  'requester_reply',
  'resolved',
  // T36 RN-13: aviso ao agente que a distribuição automática escolheu.
  'ticket_assigned',
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
  ticket_assigned: true,
  access_request_created: true,
  access_granted: true,
};

/** Texto entre o `[#n]` e o assunto do ticket (T36 RN-13). */
const SUBJECT_PREFIX: Partial<Record<NotificationTemplate, string>> = {
  ticket_assigned: 'Chamado atribuído a você: ',
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
  /** T32 RN-19: só nas imagens do texto (o corpo as referencia pelo id). Ausente antes da T32. */
  id: z.string().optional(),
  inline: z.boolean().optional(),
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
  /**
   * Assinatura do agente, já sanitizada, só no `reply` escrito no portal (T31 RN-08). Ausente
   * nas linhas gravadas antes da T31 (RN-10).
   */
  signatureHtml: z.string().nullable().optional(),
  /** T33 RN-11: as imagens que a assinatura referencia. Ausente sem imagem e antes da T33. */
  signatureImages: z
    .array(
      z.object({
        id: z.string(),
        storageKey: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number(),
      }),
    )
    .optional(),
  /**
   * T40 RN-06: link de avaliação (`<PORTAL_URL>/avaliar#<token>`), só no e-mail de resolvido ao
   * solicitante, e a validade em dias. Ausentes nos outros e nas linhas gravadas antes da T40.
   */
  csatUrl: z.string().nullable().optional(),
  csatDays: z.number().optional(),
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

type Block =
  | { kind: 'text'; value: string }
  | { kind: 'message'; html: string; plain: string; signatureHtml: string | null }
  | { kind: 'survey'; url: string; days: number | null };

const text = (value: string): Block => ({ kind: 'text', value });

const REPLY_LINE = 'Responda este e-mail para continuar o atendimento.';

/** T32: `<img data-attachment-id>` do corpo sanitizado (o atributo só sai do servidor). */
const INLINE_IMAGE = /<img\b[^>]*\sdata-attachment-id="([^"]+)"[^>]*>/gi;
const ALT = /\salt="([^"]*)"/i;

/**
 * T32 RN-15 a RN-18: cada imagem do texto vira `<img src="cid:…">` quando foi embutida, ou o
 * texto `[imagem: nome]`; na versão texto, sempre o texto.
 */
function withInlineImages(
  html: string,
  attachments: readonly PayloadAttachment[],
  inlineCids: ReadonlyMap<string, string> | null,
): { html: string; plain: string; missing: boolean } {
  const label = (id: string) => {
    const name = attachments.find((a) => a.inline && a.id === id)?.filename;
    return name ? `[imagem: ${name}]` : '[imagem]';
  };
  let missing = false;
  const embedded = html.replace(INLINE_IMAGE, (tag, id: string) => {
    const cid = inlineCids?.get(id);
    if (!cid) {
      missing = true;
      return escapeHtml(label(id));
    }
    const alt = ALT.exec(tag)?.[1] ?? '';
    return `<img src="cid:${escapeHtml(cid)}" alt="${alt}" style="max-width:100%;height:auto">`;
  });
  const plain = htmlToText(html.replace(INLINE_IMAGE, (_tag, id: string) => escapeHtml(label(id))));
  return { html: embedded, plain, missing };
}

/** T33: `<img data-signature-image-id>` da assinatura sanitizada. */
const SIGNATURE_IMAGE = /<img\b[^>]*\sdata-signature-image-id="([^"]+)"[^>]*>/gi;

/**
 * T33 RN-10 e RN-12: cada imagem da assinatura vira `<img src="cid:…">` com largura limitada;
 * a que não foi embutida some, sem aviso. A versão texto já descarta as tags (RN-13).
 */
function withSignatureImages(
  signature: string,
  signatureCids: ReadonlyMap<string, string> | null,
): string {
  return signature.replace(SIGNATURE_IMAGE, (tag, id: string) => {
    const cid = signatureCids?.get(id);
    if (!cid) return '';
    const alt = ALT.exec(tag)?.[1] ?? '';
    return `<img src="cid:${escapeHtml(cid)}" alt="${alt}" style="max-width:300px;height:auto">`;
  });
}

/**
 * RN-16 e RN-18. `attached`: os anexos comuns foram junto no e-mail; senão, só os nomes aparecem
 * no corpo (RN-19). `inlineCids`: o `cid` de cada imagem do texto embutida, pelo id do anexo;
 * `null` quando não foram embutidas (T32 RN-18). `signatureCids`: o mesmo para as imagens da
 * assinatura (T33 RN-10, RN-12).
 */
export function renderNotification(
  template: NotificationTemplate,
  payload: NotificationPayload,
  attached: boolean,
  inlineCids: ReadonlyMap<string, string> | null = null,
  signatureCids: ReadonlyMap<string, string> | null = null,
): RenderedMail {
  const blocks = [...intro(template, payload)];
  let imagesMissing = false;
  if (payload.bodyHtml) {
    const body = withInlineImages(payload.bodyHtml, payload.attachments, inlineCids);
    imagesMissing = body.missing;
    // T31 RN-08: só a resposta do agente leva assinatura.
    const signature = template === 'reply' ? (payload.signatureHtml ?? null) : null;
    blocks.push({
      kind: 'message',
      html: body.html,
      plain: body.plain,
      signatureHtml: signature && withSignatureImages(signature, signatureCids),
    });
  }
  // Assinatura só com imagens que não foram embutidas: nada sobra para mostrar.
  const last = blocks.at(-1);
  if (last?.kind === 'message' && last.signatureHtml !== null) {
    const empty = htmlToText(last.signatureHtml) === '' && !/<img\s/i.test(last.signatureHtml);
    if (empty) last.signatureHtml = null;
  }
  if (imagesMissing) {
    blocks.push(
      text(
        payload.portalUrl
          ? 'Imagens grandes demais para o e-mail, disponíveis no portal.'
          : 'Imagens grandes demais para o e-mail.',
      ),
    );
  }
  const regular = payload.attachments.filter((a) => !a.inline);
  if (regular.length > 0 && !attached) {
    const names = regular.map((a) => a.filename).join(', ');
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
  // T40 RN-01 e RN-06: o pedido de avaliação vai no e-mail que resolve o chamado.
  const resolves = template === 'resolved' || (template === 'reply' && payload.resolved);
  if (resolves && payload.csatUrl) {
    blocks.push({ kind: 'survey', url: payload.csatUrl, days: payload.csatDays ?? null });
  }
  // RN-18: avisos sem ticket não são conversas — nada para responder.
  if (payload.ticketNumber !== null) blocks.push(text(REPLY_LINE));

  return {
    subject:
      payload.ticketNumber !== null
        ? `[#${payload.ticketNumber}] ${SUBJECT_PREFIX[template] ?? ''}${payload.ticketSubject}`
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
    case 'ticket_assigned':
      return [
        text(`Olá, ${p.recipientName}.`),
        text(
          `O chamado ${ticket} foi atribuído a você pela distribuição automática da fila ${p.groupName ?? ''}.`,
        ),
        text(
          [
            `Solicitante: ${p.requesterName}`,
            `Unidade: ${p.companyName ?? 'sem unidade'}`,
            `Categoria: ${p.categoryName ?? '—'}`,
          ].join(' · '),
        ),
      ];
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

const SURVEY_INTRO = 'Como foi o atendimento? Escolha uma nota:';

const surveyValidity = (days: number | null) =>
  days === null ? null : `O link vale por ${days} ${days === 1 ? 'dia' : 'dias'}.`;

/** T40 RN-06: um link por nota, com o rótulo. */
function surveyHtml(url: string, days: number | null): string {
  const links = SATISFACTION_SCORES.map((score) => {
    const href = escapeHtml(surveyScoreUrl(url, score));
    const label = escapeHtml(`${score} — ${SATISFACTION_LABELS[score]}`);
    return `<a href="${href}" style="display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border:1px solid #bbb;border-radius:4px;color:#222;text-decoration:none">${label}</a>`;
  }).join('');
  const validity = surveyValidity(days);
  return [
    `<p style="margin:0 0 8px">${escapeHtml(SURVEY_INTRO)}</p>`,
    `<p style="margin:0 0 6px">${links}</p>`,
    validity
      ? `<p style="margin:0 0 12px;font-size:12px;color:#777">${escapeHtml(validity)}</p>`
      : '',
  ].join('');
}

function surveyText(url: string, days: number | null): string {
  const lines = SATISFACTION_SCORES.map(
    (score) => `${score} — ${SATISFACTION_LABELS[score]}: ${surveyScoreUrl(url, score)}`,
  );
  const validity = surveyValidity(days);
  return [SURVEY_INTRO, ...lines, ...(validity ? [validity] : [])].join('\n');
}

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'text':
      return `<p style="margin:0 0 12px">${escapeHtml(block.value)}</p>`;
    case 'survey':
      return surveyHtml(block.url, block.days);
    default:
      return `<div style="margin:0 0 12px;padding:12px;border-left:3px solid #ccc;background:#f7f7f7">${block.html}${signatureBlock(block.signatureHtml)}</div>`;
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'text':
      return block.value;
    case 'survey':
      return surveyText(block.url, block.days);
    default:
      return `${block.plain}${signatureText(block.signatureHtml)}`;
  }
}

function toHtml(blocks: Block[], portalUrl: string | null): string {
  const parts = blocks.map(blockHtml);
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
  const parts = blocks.map(blockText);
  if (portalUrl) parts.push(`Ou acompanhe pelo portal: ${portalUrl}`);
  parts.push('--\nSuporte MSMT — Missão Salesiana de Mato Grosso');
  return `${parts.join('\n\n')}\n`;
}

/** T31 RN-11: a assinatura fica no bloco da mensagem, depois do corpo. */
function signatureBlock(signature: string | null): string {
  return signature ? `<div style="margin:16px 0 0">${signature}</div>` : '';
}

/** T31 RN-12: depois do corpo, o separador de assinatura (`-- `) e a assinatura em texto. */
function signatureText(signature: string | null): string {
  return signature ? `\n\n-- \n${htmlToText(signature)}` : '';
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
