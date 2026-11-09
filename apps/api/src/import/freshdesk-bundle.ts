import type { TicketPriority } from '@helpdesk/shared';
import { z } from 'zod';
import { splitHtmlReply, type SplitReply } from '../inbound-email/reply-splitter.js';

// T29: formato do pacote gerado por scripts/freshdesk-bundle.mjs, e as conversões puras do import.

const person = z.object({ email: z.string().min(3), name: z.string() });
const file = z.object({ file: z.string().min(1), name: z.string() });

const message = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  private: z.boolean(),
  author: person.nullable(),
  html: z.string(),
  attachments: z.array(file),
});

const ticketSchema = z.object({
  freshdeskId: z.number().int().positive(),
  subject: z.string(),
  status: z.enum(['open', 'pending']),
  priority: z.number().int(),
  source: z.enum(['email', 'portal', 'phone']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  group: z.string().nullable(),
  toEmails: z.array(z.string()),
  requester: person,
  responder: person.nullable(),
  html: z.string(),
  attachments: z.array(file),
  messages: z.array(message),
});

export const bundleSchema = z.object({ version: z.literal(1), tickets: z.array(ticketSchema) });
export type Bundle = z.infer<typeof bundleSchema>;
export type BundleTicket = z.infer<typeof ticketSchema>;
export type BundlePerson = z.infer<typeof person>;

/**
 * Prioridade do Freshdesk (1 baixa … 4 urgente). "Baixa" é o padrão de lá e quase todo chamado
 * a tem, então vira "média", o padrão daqui (o mesmo dos chamados que chegam por e-mail).
 */
export function mapPriority(priority: number): TicketPriority {
  if (priority === 3) return 'high';
  if (priority === 4) return 'urgent';
  return 'medium';
}

/** Assunto comparável: sem "Re:/Fwd:/Enc:", sem `[#123]`, sem espaços extras, em minúsculas. */
export function normalizeSubject(subject: string): string {
  let result = subject.toLowerCase().replaceAll(/\[#\d+\]/g, ' ');
  const prefix = /^\s*(?:re|res|fw|fwd|enc|tr)\s*:\s*/;
  while (prefix.test(result)) result = result.replace(prefix, '');
  return result.replaceAll(/\s+/g, ' ').trim();
}

const INLINE = /<img\b[^>]*?\bsrc\s*=\s*"fd-inline(-missing)?:([^"]*)"[^>]*>/gi;

/**
 * Imagens coladas: o pacote troca o `src` por `fd-inline:<arquivo>`. Aqui a imagem sai do texto
 * (o portal só serve anexos com autenticação, o que um `<img>` não manda) e vira anexo, com um aviso
 * no lugar.
 */
export function extractInlineImages(html: string): { html: string; files: string[] } {
  const files: string[] = [];
  const result = html.replaceAll(INLINE, (_match, missing: string | undefined, path: string) => {
    if (missing) return '[imagem colada indisponível]';
    files.push(path);
    return `[imagem colada: ${path.split('/').pop() ?? path}, nos anexos]`;
  });
  return { html: result, files };
}

const FRESHDESK_QUOTE = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bfreshdesk_quote\b/i;

/** Texto novo e citação: o marcador do Freshdesk primeiro, depois os dos clientes de e-mail. */
export function splitQuote(html: string): SplitReply {
  const cut = html.search(FRESHDESK_QUOTE);
  if (cut > 0) return { body: html.slice(0, cut), quoted: html.slice(cut) };
  return splitHtmlReply(html);
}

export interface GroupRules {
  /** Nome do grupo no Freshdesk → nome do grupo daqui. */
  groups: ReadonlyMap<string, string>;
  /** Caixa de destino (para chamados sem grupo) → nome do grupo daqui. */
  mailboxes: ReadonlyMap<string, string>;
}

/** Padrões da MSMT; `--map-group` e `--map-mailbox` acrescentam ou trocam. */
export const DEFAULT_GROUP_RULES: GroupRules = {
  groups: new Map([
    ['Suporte TI - Sede Inspetorial', 'Suporte TI'],
    ['Suporte TI - CSDB CG', 'Suporte TI'],
    ['Cadastro de Clientes e Fornecedores', 'Cadastros'],
  ]),
  mailboxes: new Map([['cadastros@missaosalesiana.org.br', 'Cadastros']]),
};

/** Nome do grupo daqui para o chamado, ou `null` (vai para o grupo padrão da categoria "Geral"). */
export function groupNameFor(
  ticket: Pick<BundleTicket, 'group' | 'toEmails'>,
  rules: GroupRules,
): string | null {
  if (ticket.group !== null) return rules.groups.get(ticket.group) ?? null;
  for (const email of ticket.toEmails) {
    const address = /[^\s<>"]+@[^\s<>"]+/.exec(email)?.[0]?.toLowerCase();
    const group = address ? rules.mailboxes.get(address) : undefined;
    if (group) return group;
  }
  return null;
}
