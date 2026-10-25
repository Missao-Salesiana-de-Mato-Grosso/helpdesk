/** Um e-mail lido da caixa, ainda bruto. */
export interface RawEmail {
  uid: number;
  raw: Buffer;
  /** Data em que a caixa recebeu (IMAP INTERNALDATE); no driver `folder`, o `Date:` do arquivo. */
  internalDate: Date;
}

export type MailboxOutcome = 'processed' | 'discarded' | 'failed';

/** RN-06: nome do rótulo (no Gmail, uma pasta IMAP) de cada destino, depois do prefixo. */
export const OUTCOME_LABELS: Record<MailboxOutcome, string> = {
  processed: 'processado',
  discarded: 'descartado',
  failed: 'erro',
};

export interface MailboxCursor {
  uidValidity: string;
  lastUid: number;
}

/** Onde o cursor mora (`app_settings`). Implementado pelo InboundEmailService. */
export interface CursorStore {
  get(): Promise<MailboxCursor | null>;
  set(cursor: MailboxCursor): Promise<void>;
  /** Data do último e-mail registrado, para recomeçar se o UIDVALIDITY mudar (RN-03). */
  lastReceivedAt(): Promise<Date | null>;
}

export interface MailboxSession {
  /** Até `limit` e-mails depois do cursor, em ordem (RN-01). */
  next(limit: number): Promise<RawEmail[]>;
  /** Rotula (nunca apaga) e avança o cursor depois deste e-mail (RN-04, RN-06). */
  done(email: RawEmail, outcome: MailboxOutcome): Promise<void>;
  close(): Promise<void>;
}

export interface MailboxSource {
  open(cursor: CursorStore): Promise<MailboxSession>;
}

export const MAILBOX_SOURCE = Symbol('MAILBOX_SOURCE');
