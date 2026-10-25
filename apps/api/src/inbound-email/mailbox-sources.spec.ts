import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderMailboxSource, headerDate } from './folder-mailbox.source.js';
import { ImapMailboxSource, type ImapClient } from './imap-mailbox.source.js';
import type { CursorStore, MailboxCursor } from './mailbox-source.js';
import { referencedIds, ticketSubject } from './inbound-email.service.js';

const eml = (date: string) => Buffer.from(`From: a@x.org\nDate: ${date}\nSubject: s\n\ncorpo`);

class MemoryCursor implements CursorStore {
  constructor(
    public cursor: MailboxCursor | null = null,
    public last: Date | null = null,
  ) {}
  get = () => Promise.resolve(this.cursor);
  set = (cursor: MailboxCursor) => {
    this.cursor = { ...cursor };
    return Promise.resolve();
  };
  lastReceivedAt = () => Promise.resolve(this.last);
}

interface FakeMessage {
  uid: number;
  internalDate: Date;
}

/** IMAP falso: uma INBOX com UIDs e datas; registra cópias (rótulos) e nunca apaga. */
function fakeImap(messages: FakeMessage[], uidValidity = 7n) {
  const copies: [string, string][] = [];
  const created: string[] = [];
  const client: ImapClient = {
    mailbox: { uidValidity, uidNext: Math.max(0, ...messages.map((m) => m.uid)) + 1 },
    connect: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getMailboxLock: () => Promise.resolve({ release: () => undefined }),
    search: (query) => {
      if (query.since) {
        const day = new Date(query.since);
        day.setUTCHours(0, 0, 0, 0);
        return Promise.resolve(messages.filter((m) => m.internalDate >= day).map((m) => m.uid));
      }
      const from = Number(query.uid!.split(':')[0]);
      const found = messages.filter((m) => m.uid >= from).map((m) => m.uid);
      // Como o IMAP: `n:*` devolve o último mesmo que seja menor que n.
      return Promise.resolve(found.length > 0 ? found : messages.slice(-1).map((m) => m.uid));
    },
    async *fetch(range) {
      const uids = new Set(range.split(',').map(Number));
      for (const m of messages) {
        if (uids.has(m.uid))
          yield { uid: m.uid, internalDate: m.internalDate, source: Buffer.from(`uid ${m.uid}`) };
      }
    },
    messageCopy: (range, destination) => {
      copies.push([range, destination]);
      return Promise.resolve(true);
    },
    mailboxCreate: (path) => {
      created.push(path);
      return Promise.resolve({});
    },
  };
  return { client, copies, created };
}

const at = (iso: string) => new Date(iso);

describe('driver imap', () => {
  const inbox = [
    { uid: 10, internalDate: at('2026-10-27T09:00:00Z') },
    { uid: 11, internalDate: at('2026-10-27T10:20:00Z') },
    { uid: 12, internalDate: at('2026-10-27T10:30:00Z') },
  ];

  it('RN-02 sem cursor e sem START_SINCE: começa depois do último (nada antigo vira ticket)', async () => {
    const { client } = fakeImap(inbox);
    const store = new MemoryCursor();
    const session = await new ImapMailboxSource(() => client, null, 'helpdesk').open(store);
    expect(await session.next(50)).toEqual([]);
    expect(store.cursor).toEqual({ uidValidity: '7', lastUid: 12 });
  });

  it('RN-02 com START_SINCE: só os e-mails a partir da hora da virada', async () => {
    const { client } = fakeImap(inbox);
    const store = new MemoryCursor();
    const source = new ImapMailboxSource(() => client, at('2026-10-27T10:15:00Z'), 'helpdesk');
    const session = await source.open(store);
    expect((await session.next(50)).map((e) => e.uid)).toEqual([11, 12]);
    expect(store.cursor?.lastUid).toBe(10);
  });

  it('RN-04 e RN-06: done rotula copiando (nunca apaga) e avança o cursor', async () => {
    const { client, copies, created } = fakeImap(inbox);
    const store = new MemoryCursor({ uidValidity: '7', lastUid: 10 });
    const session = await new ImapMailboxSource(() => client, null, 'helpdesk').open(store);
    const [first, second] = await session.next(50);
    await session.done(first!, 'processed');
    await session.done(second!, 'failed');
    expect(copies).toEqual([
      ['11', 'helpdesk/processado'],
      ['12', 'helpdesk/erro'],
    ]);
    expect(created).toEqual(['helpdesk/processado', 'helpdesk/erro']);
    expect(store.cursor?.lastUid).toBe(12);
    expect(await session.next(50)).toEqual([]);
  });

  it('respeita o limite do lote', async () => {
    const { client } = fakeImap(inbox);
    const store = new MemoryCursor({ uidValidity: '7', lastUid: 0 });
    const session = await new ImapMailboxSource(() => client, null, 'helpdesk').open(store);
    expect((await session.next(2)).map((e) => e.uid)).toEqual([10, 11]);
  });

  it('RN-03 UIDVALIDITY mudou: recomeça pela data do último e-mail registrado', async () => {
    const { client } = fakeImap(inbox, 8n);
    const store = new MemoryCursor({ uidValidity: '7', lastUid: 999 }, at('2026-10-27T10:20:00Z'));
    const session = await new ImapMailboxSource(() => client, null, 'helpdesk').open(store);
    expect((await session.next(50)).map((e) => e.uid)).toEqual([11, 12]);
    expect(store.cursor?.uidValidity).toBe('8');
  });

  it('falha ao rotular não trava o cursor', async () => {
    const { client } = fakeImap(inbox);
    client.messageCopy = () => Promise.reject(new Error('sem permissão'));
    const store = new MemoryCursor({ uidValidity: '7', lastUid: 11 });
    const session = await new ImapMailboxSource(() => client, null, 'helpdesk').open(store);
    const [email] = await session.next(50);
    await session.done(email!, 'processed');
    expect(store.cursor?.lastUid).toBe(12);
  });
});

describe('driver folder', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'inbox-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lê em ordem de nome, move para a pasta do destino e ignora os anteriores à virada', async () => {
    await writeFile(join(dir, 'a.eml'), eml('Mon, 26 Oct 2026 09:00:00 -0400'));
    await writeFile(join(dir, 'b.eml'), eml('Tue, 27 Oct 2026 09:00:00 -0400'));
    await writeFile(join(dir, 'c.eml'), eml('Tue, 27 Oct 2026 10:00:00 -0400'));
    await writeFile(join(dir, 'leia-me.txt'), 'não é e-mail');
    const source = new FolderMailboxSource(dir, at('2026-10-27T12:00:00Z'));
    const session = await source.open();
    const emails = await session.next(50);
    expect(emails).toHaveLength(2);
    await session.done(emails[0]!, 'processed');
    await session.done(emails[1]!, 'discarded');
    expect((await readdir(join(dir, 'ignorado'))).toSorted()).toEqual(['a.eml']);
    expect(await readdir(join(dir, 'processado'))).toEqual(['b.eml']);
    expect(await readdir(join(dir, 'descartado'))).toEqual(['c.eml']);
    expect(await (await source.open()).next(50)).toEqual([]);
  });

  it('pasta inexistente = nada a ler', async () => {
    const session = await new FolderMailboxSource(join(dir, 'nao-existe'), null).open();
    expect(await session.next(50)).toEqual([]);
  });

  it('headerDate lê o Date: e ignora o corpo', () => {
    expect(headerDate(eml('Tue, 27 Oct 2026 10:00:00 -0400'))?.toISOString()).toBe(
      '2026-10-27T14:00:00.000Z',
    );
    expect(headerDate(Buffer.from('From: a@x.org\n\nDate: Tue, 27 Oct 2026'))).toBeNull();
  });
});

describe('threading e assunto', () => {
  it('referencedIds: In-Reply-To primeiro, depois References do último para o primeiro', () => {
    expect(referencedIds({ inReplyTo: '<c@x>', references: ['<a@x> <b@x>', '<c@x>'] })).toEqual([
      '<c@x>',
      '<b@x>',
      '<a@x>',
    ]);
    expect(referencedIds({ references: '<a@x>' })).toEqual(['<a@x>']);
    expect(referencedIds({})).toEqual([]);
  });

  it('ticketSubject tira as tags e limita o tamanho', () => {
    expect(ticketSubject('Re: [#1001]  Impressora [#22]')).toBe('Re: Impressora');
    expect(ticketSubject('  ')).toBe('(sem assunto)');
    expect(ticketSubject(undefined)).toBe('(sem assunto)');
    expect(ticketSubject('x'.repeat(300))).toHaveLength(200);
  });
});
