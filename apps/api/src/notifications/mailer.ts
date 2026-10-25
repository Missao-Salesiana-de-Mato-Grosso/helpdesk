import type { Readable } from 'node:stream';
import nodemailer, { type Transporter } from 'nodemailer';

/** Um e-mail pronto para o SMTP. Montado pelo NotificationService a partir da outbox. */
export interface OutgoingMail {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Com os sinais `<>`. */
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  headers: Record<string, string>;
  attachments: { filename: string; contentType: string; content: Readable }[];
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
}

/** Envio pelo SMTP (Mailpit em dev, Gmail em produção). */
export class NodemailerMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({
      from: mail.from,
      replyTo: mail.replyTo,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      headers: mail.headers,
      attachments: mail.attachments,
    });
  }
}

/**
 * Falha definitiva: o servidor recusou com 5xx (destinatário inexistente, mensagem rejeitada).
 * Rede, timeout e 4xx são temporárias e voltam para a fila (RN-14).
 */
export function isPermanentFailure(error: unknown): boolean {
  const code = smtpResponseCode(error);
  return code !== undefined && code >= 500 && code < 600;
}

/** Código e mensagem do erro, para `last_error`. Nunca inclui o conteúdo do e-mail. */
export function describeFailure(error: unknown): string {
  const code = smtpResponseCode(error) ?? errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return (code === undefined ? message : `${code} ${message}`).slice(0, 500);
}

function smtpResponseCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('responseCode' in error)) return undefined;
  return typeof error.responseCode === 'number' ? error.responseCode : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
