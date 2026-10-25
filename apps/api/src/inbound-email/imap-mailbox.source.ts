import { Logger } from '@nestjs/common';
import {
  OUTCOME_LABELS,
  type CursorStore,
  type MailboxCursor,
  type MailboxSession,
  type MailboxSource,
  type RawEmail,
} from './mailbox-source.js';

/** O pedaço do `ImapFlow` que o driver usa (permite um cliente falso nos testes). */
export interface ImapClient {
  readonly mailbox: { uidValidity: bigint; uidNext: number } | false;
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(
    query: { since?: Date; uid?: string },
    options: { uid: true },
  ): Promise<number[] | false | undefined>;
  fetch(
    range: string,
    query: { uid: true; source?: boolean; internalDate: true },
    options: { uid: true },
  ): AsyncIterable<{ uid: number; source?: Buffer; internalDate?: Date | string }>;
  messageCopy(range: string, destination: string, options: { uid: true }): Promise<unknown>;
  mailboxCreate(path: string): Promise<unknown>;
}

const toDate = (value: Date | string | undefined) =>
  value === undefined ? new Date(0) : new Date(value);

/**
 * Driver `imap` (ADR-010): lê a INBOX por UID, sem tocar na flag de lido (RN-01). O cursor fica
 * no `CursorStore`. Rotula copiando para a pasta do rótulo, o que no Gmail aplica o rótulo e
 * mantém o e-mail na INBOX (RN-06). Nunca apaga.
 */
export class ImapMailboxSource implements MailboxSource {
  private readonly logger = new Logger(ImapMailboxSource.name);

  constructor(
    private readonly createClient: () => ImapClient,
    private readonly startSince: Date | null,
    private readonly labelPrefix: string,
  ) {}

  async open(store: CursorStore): Promise<MailboxSession> {
    const client = this.createClient();
    await client.connect();
    let lock: { release(): void };
    try {
      lock = await client.getMailboxLock('INBOX');
    } catch (error) {
      await client.logout();
      throw error;
    }
    const close = async () => {
      lock.release();
      await client.logout();
    };

    try {
      const cursor = await this.initialCursor(client, store);
      const labels = new Set<string>();
      return {
        next: (limit) => this.fetchAfter(client, cursor, limit),
        done: async (email, outcome) => {
          await this.label(client, labels, email.uid, OUTCOME_LABELS[outcome]);
          cursor.lastUid = Math.max(cursor.lastUid, email.uid);
          await store.set(cursor);
        },
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  }

  /** RN-02 e RN-03: cursor gravado, ou um novo pela data (virada, ou recomeço após UIDVALIDITY). */
  private async initialCursor(client: ImapClient, store: CursorStore): Promise<MailboxCursor> {
    const box = client.mailbox;
    if (!box) throw new Error('INBOX não foi aberta');
    const uidValidity = String(box.uidValidity);
    const saved = await store.get();
    if (saved?.uidValidity === uidValidity) return saved;

    if (saved) {
      this.logger.warn(
        `UIDVALIDITY mudou (${saved.uidValidity} → ${uidValidity}); recomeçando pela data`,
      );
    }
    const since = saved ? await store.lastReceivedAt() : this.startSince;
    const lastUid = since
      ? (await this.firstUidSince(client, since, box.uidNext)) - 1
      : box.uidNext - 1;
    const cursor = { uidValidity, lastUid };
    await store.set(cursor);
    this.logger.log(
      `Cursor inicial da INBOX: UID ${lastUid}${since ? ` (a partir de ${since.toISOString()})` : ''}`,
    );
    return cursor;
  }

  /** Primeiro UID com data interna ≥ `since` (o SEARCH SINCE do IMAP só olha o dia). */
  private async firstUidSince(client: ImapClient, since: Date, uidNext: number): Promise<number> {
    const uids = (await client.search({ since }, { uid: true })) || [];
    if (uids.length === 0) return uidNext;
    const sorted = uids.toSorted((a, b) => a - b);
    for await (const message of client.fetch(
      sorted.join(','),
      { uid: true, internalDate: true },
      { uid: true },
    )) {
      if (toDate(message.internalDate) >= since) return message.uid;
    }
    return uidNext;
  }

  private async fetchAfter(
    client: ImapClient,
    cursor: MailboxCursor,
    limit: number,
  ): Promise<RawEmail[]> {
    const found = (await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || [];
    // `n:*` sempre devolve o último UID, mesmo menor que n.
    const uids = found
      .filter((uid) => uid > cursor.lastUid)
      .toSorted((a, b) => a - b)
      .slice(0, limit);
    if (uids.length === 0) return [];
    const emails: RawEmail[] = [];
    for await (const message of client.fetch(
      uids.join(','),
      { uid: true, source: true, internalDate: true },
      { uid: true },
    )) {
      if (message.source) {
        emails.push({
          uid: message.uid,
          raw: message.source,
          internalDate: toDate(message.internalDate),
        });
      }
    }
    return emails.toSorted((a, b) => a.uid - b.uid);
  }

  /** Falha ao rotular vai para o log e não trava o cursor (RN-06). */
  private async label(client: ImapClient, ensured: Set<string>, uid: number, name: string) {
    const path = `${this.labelPrefix}/${name}`;
    try {
      if (!ensured.has(path)) {
        await client.mailboxCreate(path).catch(() => undefined);
        ensured.add(path);
      }
      await client.messageCopy(String(uid), path, { uid: true });
    } catch (error) {
      this.logger.warn(
        `Não foi possível rotular o UID ${uid} com ${path}: ${error instanceof Error ? error.message : 'erro'}`,
      );
    }
  }
}
