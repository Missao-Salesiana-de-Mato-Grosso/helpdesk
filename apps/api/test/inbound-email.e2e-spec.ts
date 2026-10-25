// Spec docs/specs/T21-inbound-email.md — e-mail de entrada pelo driver `folder`, com fixtures .eml.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { STORAGE_DRIVER, type StorageDriver } from '../src/attachments/storage/storage-driver.js';
import { FolderMailboxSource } from '../src/inbound-email/folder-mailbox.source.js';
import { InboundEmailService } from '../src/inbound-email/inbound-email.service.js';
import { MAILER, type Mailer, type OutgoingMail } from '../src/notifications/mailer.js';
import { NotificationService } from '../src/notifications/notification.service.js';
import { E2E_INBOX_PATH } from '../vitest.config.e2e.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'inbound');
const INBOX = E2E_INBOX_PATH;
const OUR_REF = '<tk-enviado@helpdesk.test>';

/** Grava o que seria enviado, sem SMTP (os cabeçalhos da saída já são testados na T14). */
class RecordingMailer implements Mailer {
  sent: OutgoingMail[] = [];
  send(mail: OutgoingMail): Promise<void> {
    for (const attachment of mail.attachments) attachment.content.destroy();
    this.sent.push(mail);
    return Promise.resolve();
  }
}

interface EmlOptions {
  from: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  headers?: string[];
  body?: string;
  contentType?: string;
}

const fixture = async (name: string, inReplyTo = OUR_REF) =>
  (await readFile(join(FIXTURES, name), 'utf8')).replaceAll('{{IN_REPLY_TO}}', inReplyTo);
const email = (user: string) => `${user}@missaosalesiana.org.br`;
const at = (date: string) =>
  eml({ from: email('req1'), subject: date }).replace(
    'Date: Sat, 24 Oct 2026 12:00:00 -0400',
    `Date: ${date}`,
  );

let counter = 0;
/** E-mail mínimo em texto puro, para as variações de cabeçalho. */
function eml(options: EmlOptions): string {
  counter += 1;
  return [
    `From: ${options.from}`,
    'To: suporte@missaosalesiana.org.br',
    `Subject: ${options.subject ?? 'Assunto'}`,
    'Date: Sat, 24 Oct 2026 12:00:00 -0400',
    `Message-ID: ${options.messageId ?? `<gerado-${counter}-${Date.now()}@teste.org>`}`,
    ...(options.inReplyTo ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(options.headers ?? []),
    `Content-Type: ${options.contentType ?? 'text/plain; charset="UTF-8"'}`,
    '',
    options.body ?? 'Corpo do e-mail',
    '',
  ].join('\n');
}

describe('e-mail de entrada — T21 (e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;
  let inbound: InboundEmailService;
  const mailer = new RecordingMailer();

  beforeAll(async () => {
    t = await createTestApp({ providers: [{ provide: MAILER, useValue: mailer }] });
    inbound = t.app.get(InboundEmailService);
  });

  afterAll(async () => {
    await t.app.close();
    await rm(INBOX, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    vi.restoreAllMocks();
    mailer.sent = [];
    await rm(INBOX, { recursive: true, force: true });
    await mkdir(INBOX, { recursive: true });
    f = await createTicketsFixture(t);
    await t.prisma.category.create({ data: { name: 'Geral', defaultGroupId: f.G1 } });
  });

  let fileCounter = 0;
  const drop = async (content: string, name?: string) => {
    fileCounter += 1;
    const file = name ?? `${String(fileCounter).padStart(4, '0')}.eml`;
    await writeFile(join(INBOX, file), content);
    return file;
  };
  const poll = () => inbound.pollMailbox();
  const inboundRows = () => t.prisma.inboundEmail.findMany({ orderBy: { createdAt: 'asc' } });
  const outbox = async () =>
    (
      await t.prisma.notification.findMany({ orderBy: [{ createdAt: 'asc' }, { toEmail: 'asc' }] })
    ).map((n) => [n.template, n.toEmail]);
  const messagesOf = (ticketId: string) =>
    t.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });
  /** Ticket com uma notificação já enviada (a ref `outbound` que o e-mail de resposta cita). */
  const ticketWithOurRef = async (
    status: 'open' | 'pending' | 'resolved' | 'closed' = 'open',
    assignee: 'ag2' | null = null,
  ) => {
    const ticket = await f.ticket({ requester: 'req1', status, assignee });
    await t.prisma.emailMessageRef.create({
      data: { messageId: OUR_REF, ticketId: ticket.id, direction: 'outbound' },
    });
    return ticket;
  };

  describe('ticket novo', () => {
    it('CT-01 remetente interno desconhecido: usuário sem login, ticket por e-mail e notificações', async () => {
      await drop(await fixture('novo-interno.eml'));
      expect(await poll()).toEqual({ processed: 1, discarded: 0, failed: 0, duplicates: 0 });

      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'novo@missaosalesiana.org.br' },
      });
      expect(user).toMatchObject({
        name: 'João Novo Silva',
        zitadelSub: null,
        isExternal: false,
        companyId: null,
      });
      const ticket = await t.prisma.ticket.findFirstOrThrow({ include: { category: true } });
      expect(ticket).toMatchObject({
        subject: 'Impressora da secretaria parou',
        source: 'email',
        requesterId: user.id,
        companyId: null,
        groupId: f.G1,
        priority: 'medium',
        status: 'open',
      });
      expect(ticket.category.name).toBe('Geral');
      const [message] = await messagesOf(ticket.id);
      expect(message).toMatchObject({ via: 'email', kind: 'public', authorId: user.id });
      expect(message!.bodyHtml).toBe(
        '<div><p>Bom dia, a impressora da <b>secretaria</b> não liga.</p></div>',
      );

      const [row] = await inboundRows();
      expect(row).toMatchObject({
        messageId: '<CAnovo001@mail.gmail.com>',
        status: 'processed',
        ticketId: ticket.id,
        fromEmail: 'novo@missaosalesiana.org.br',
      });
      expect(row!.rawStorageKey).toMatch(/^inbound\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.eml$/);
      expect(
        await t.prisma.emailMessageRef.findMany({ select: { messageId: true, direction: true } }),
      ).toEqual([{ messageId: '<CAnovo001@mail.gmail.com>', direction: 'inbound' }]);
      expect(await outbox()).toEqual([
        ['ticket_created_group', email('ag1')],
        ['ticket_created', 'novo@missaosalesiana.org.br'],
      ]);
      expect(await readdir(join(INBOX, 'processado'))).toHaveLength(1);

      // RN-16 + T14: a confirmação responde ao e-mail da pessoa.
      await t.app.get(NotificationService).processOutbox();
      const confirmation = mailer.sent.find((m) => m.to === 'novo@missaosalesiana.org.br')!;
      expect(confirmation.inReplyTo).toBe('<CAnovo001@mail.gmail.com>');
      expect(confirmation.subject).toBe(`[#${ticket.number}] Impressora da secretaria parou`);
    });

    it('CT-02 domínio externo: terceiro, confirmação sem link do portal', async () => {
      await drop(eml({ from: 'Fornecedor <fornecedor@empresa.com>', subject: 'Orçamento' }));
      await poll();
      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'fornecedor@empresa.com' },
      });
      expect(user).toMatchObject({ isExternal: true, name: 'Fornecedor' });
      const confirmation = await t.prisma.notification.findFirstOrThrow({
        where: { template: 'ticket_created' },
      });
      expect(confirmation.payload).toMatchObject({ portalUrl: null });
    });

    it('remetente conhecido: usa o usuário existente e a unidade dele', async () => {
      await drop(eml({ from: email('req1'), subject: 'Sem internet' }));
      await poll();
      const ticket = await t.prisma.ticket.findFirstOrThrow();
      expect(ticket).toMatchObject({ requesterId: f.users.req1, companyId: f.U1 });
      expect(await t.prisma.user.count()).toBe(7);
    });

    it('sem a categoria "Geral": failed com o motivo, sem ticket', async () => {
      await t.prisma.category.updateMany({ where: { name: 'Geral' }, data: { active: false } });
      await drop(eml({ from: email('req1') }));
      expect((await poll()).failed).toBe(1);
      expect((await inboundRows())[0]).toMatchObject({
        status: 'failed',
        reason: 'no_default_category',
      });
      expect(await t.prisma.ticket.count()).toBe(0);
    });
  });

  describe('resposta a ticket existente (RN-11 a RN-13)', () => {
    it('CT-03 solicitante responde a ticket pendente: mensagem, reabre e avisa o grupo', async () => {
      const ticket = await ticketWithOurRef('pending');
      await drop(await fixture('gmail-reply.eml'));
      await poll();

      const messages = await messagesOf(ticket.id);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toMatchObject({ via: 'email', kind: 'public', authorId: f.users.req1 });
      expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
        'open',
      );
      expect(
        await t.prisma.emailMessageRef.findUnique({
          where: { messageId: '<CAgmail002@mail.gmail.com>' },
        }),
      ).toMatchObject({ ticketId: ticket.id, direction: 'inbound' });
      expect(await outbox()).toEqual([['requester_reply', email('ag1')]]);

      await t.app.get(NotificationService).processOutbox();
      expect(mailer.sent[0]!.inReplyTo).toBe('<CAgmail002@mail.gmail.com>');
    });

    it('CT-04 resposta a ticket resolvido reabre', async () => {
      const ticket = await ticketWithOurRef('resolved');
      await drop(await fixture('gmail-reply.eml'));
      await poll();
      expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
        'open',
      );
    });

    it('CT-05 resposta a ticket fechado: ticket novo ligado ao anterior', async () => {
      const closed = await ticketWithOurRef('closed');
      await drop(await fixture('gmail-reply.eml'));
      await poll();
      expect(await messagesOf(closed.id)).toHaveLength(1);
      const created = await t.prisma.ticket.findFirstOrThrow({ where: { id: { not: closed.id } } });
      expect(created).toMatchObject({
        source: 'email',
        requesterId: f.users.req1,
        subject: 'Re: Ticket de teste',
      });
      const event = await t.prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: created.id, type: 'created' },
      });
      expect(event.data).toEqual({ relatedTicketId: closed.id });
      expect((await inboundRows())[0]!.ticketId).toBe(created.id);
    });

    it('CT-06 só a tag [#n], do solicitante: entra no ticket', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await drop(eml({ from: email('req1'), subject: `Re: [#${ticket.number}] Ticket de teste` }));
      await poll();
      expect(await messagesOf(ticket.id)).toHaveLength(2);
      expect(await t.prisma.ticket.count()).toBe(1);
    });

    it('CT-07 só a tag [#n], de um desconhecido: ticket novo, sem tocar o existente', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await drop(eml({ from: 'curioso@x.org', subject: `[#${ticket.number}] Quero ver` }));
      await poll();
      expect(await messagesOf(ticket.id)).toHaveLength(1);
      const created = await t.prisma.ticket.findFirstOrThrow({ where: { id: { not: ticket.id } } });
      expect(created.subject).toBe('Quero ver');
    });

    it('tag [#n] de um agente também vale', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await drop(eml({ from: email('ag2'), subject: `[#${ticket.number}] Ticket de teste` }));
      await poll();
      expect(await messagesOf(ticket.id)).toHaveLength(2);
    });

    it('CT-08 agente responde pelo Gmail: mensagem pública dele, status igual, primeira resposta', async () => {
      const ticket = await ticketWithOurRef('open');
      await drop(eml({ from: email('ag1'), inReplyTo: OUR_REF, body: 'Já troquei o toner.' }));
      await poll();
      const messages = await messagesOf(ticket.id);
      expect(messages[1]).toMatchObject({ authorId: f.users.ag1, kind: 'public', via: 'email' });
      const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.status).toBe('open');
      expect(row.firstResponseAt).toBeInstanceOf(Date);
      expect(await outbox()).toEqual([['reply', email('req1')]]);
    });

    it('agente de outro grupo responde ao thread: aceito (escopo do e-mail)', async () => {
      const ticket = await ticketWithOurRef('open');
      await drop(eml({ from: email('ag2'), inReplyTo: OUR_REF }));
      await poll();
      expect((await messagesOf(ticket.id))[1]!.authorId).toBe(f.users.ag2);
    });

    it('CT-09 colega em cópia responde: mensagem dele, aviso ao responsável, não ao solicitante', async () => {
      const ticket = await ticketWithOurRef('pending', 'ag2');
      await drop(eml({ from: 'Colega <colega@missaosalesiana.org.br>', inReplyTo: OUR_REF }));
      await poll();
      const colleague = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'colega@missaosalesiana.org.br' },
      });
      expect((await messagesOf(ticket.id))[1]!.authorId).toBe(colleague.id);
      expect((await t.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
        'open',
      );
      expect(await outbox()).toEqual([['requester_reply', email('ag2')]]);
    });

    it('References (sem In-Reply-To) também liga ao ticket', async () => {
      const ticket = await ticketWithOurRef('open');
      await drop(eml({ from: email('req1'), headers: [`References: <outro@x.org> ${OUR_REF}`] }));
      await poll();
      expect(await messagesOf(ticket.id)).toHaveLength(2);
    });
  });

  describe('descarte e idempotência (RN-05, RN-08)', () => {
    it('CT-10 resposta automática de férias: descartada, nada criado nem enviado', async () => {
      await ticketWithOurRef('open');
      await drop(
        eml({ from: email('req1'), inReplyTo: OUR_REF, headers: ['Auto-Submitted: auto-replied'] }),
      );
      expect((await poll()).discarded).toBe(1);
      expect((await inboundRows())[0]).toMatchObject({
        status: 'discarded',
        reason: 'auto_submitted',
        ticketId: null,
      });
      expect(await t.prisma.ticketMessage.count()).toBe(1);
      expect(await outbox()).toEqual([]);
      expect(await readdir(join(INBOX, 'descartado'))).toHaveLength(1);
    });

    it('CT-11 cada regra de descarte grava o motivo certo', async () => {
      await t.prisma.user.update({ where: { id: f.users.req2 }, data: { active: false } });
      const cases: [EmlOptions, string][] = [
        [{ from: 'a@x.org', headers: ['Precedence: bulk'] }, 'bulk'],
        [{ from: 'b@x.org', headers: ['X-Autoreply: yes'] }, 'auto_reply'],
        [{ from: 'Suporte <SUPORTE@missaosalesiana.org.br>' }, 'own_address'],
        [
          {
            from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
            contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
            body: '--b\nContent-Type: text/plain\n\nFalhou\n--b--',
          },
          'bounce',
        ],
        [
          {
            from: email('ag1'),
            headers: [
              'Authentication-Results: mx.google.com; spf=fail; dmarc=fail (p=QUARANTINE) header.from=missaosalesiana.org.br',
            ],
          },
          'dmarc_fail',
        ],
        [{ from: email('req2') }, 'inactive_sender'],
      ];
      for (const [options] of cases) await drop(eml(options));
      expect((await poll()).discarded).toBe(cases.length);
      expect((await inboundRows()).map((r) => r.reason)).toEqual(cases.map(([, reason]) => reason));
      expect(await t.prisma.ticket.count()).toBe(0);
      expect(await outbox()).toEqual([]);
    });

    it('CT-12 o mesmo Message-ID duas vezes: um ticket e uma linha', async () => {
      const content = eml({ from: email('req1'), messageId: '<repetido@x.org>' });
      await drop(content);
      await poll();
      await drop(content);
      expect(await poll()).toEqual({ processed: 0, discarded: 0, failed: 0, duplicates: 1 });
      expect(await t.prisma.ticket.count()).toBe(1);
      expect(await t.prisma.inboundEmail.count()).toBe(1);
    });

    it('CT-13 o 21º e-mail do mesmo remetente na hora é descartado', async () => {
      const logs = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      for (let i = 0; i < 21; i += 1)
        await drop(eml({ from: 'loop@x.org', subject: `E-mail ${i}` }));
      expect(await poll()).toEqual({ processed: 20, discarded: 1, failed: 0, duplicates: 0 });
      expect((await inboundRows()).at(-1)).toMatchObject({ reason: 'rate_limited' });
      expect(logs.mock.calls.flat().join(' ')).toContain('rate_limited');
    });
  });

  describe('falhas (RN-04)', () => {
    it('CT-14 e-mail sem remetente vira failed e não segura os outros', async () => {
      await drop('Subject: sem from\n\nlixo\n', '0001-quebrado.eml');
      await drop(eml({ from: email('req1') }), '0002-bom.eml');
      expect(await poll()).toEqual({ processed: 1, discarded: 0, failed: 1, duplicates: 0 });
      expect((await inboundRows())[0]).toMatchObject({ status: 'failed', reason: 'no_sender' });
      expect(await readdir(join(INBOX, 'erro'))).toEqual(['0001-quebrado.eml']);
      expect(await readdir(join(INBOX, 'processado'))).toEqual(['0002-bom.eml']);
    });

    it('CT-15 storage fora do ar: nada gravado, o e-mail fica para o próximo ciclo', async () => {
      const storage = t.app.get<StorageDriver>(STORAGE_DRIVER);
      vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('storage indisponível'));
      const file = await drop(eml({ from: email('req1') }));
      await expect(poll()).rejects.toThrow('storage indisponível');
      expect(await t.prisma.inboundEmail.count()).toBe(0);
      expect(await readdir(INBOX)).toContain(file);

      expect((await poll()).processed).toBe(1);
      expect(await t.prisma.ticket.count()).toBe(1);
    });
  });

  describe('conteúdo (RN-17 a RN-20)', () => {
    it('CT-16 anexos: PDF e imagem inline salvos; .exe listado no corpo', async () => {
      await drop(await fixture('com-anexos.eml'));
      await poll();
      const ticket = await t.prisma.ticket.findFirstOrThrow();
      const [message] = await messagesOf(ticket.id);
      expect(
        message!.attachments
          .map((a) => [a.filename, a.mimeType])
          .toSorted((a, b) => a[0]!.localeCompare(b[0]!)),
      ).toEqual([
        ['imagem-1.png', 'image/png'],
        ['relatório.pdf', 'application/pdf'],
      ]);
      expect(message!.bodyHtml).toContain('Segue o print:');
      expect(message!.bodyHtml).not.toContain('cid:');
      expect(message!.bodyHtml).toMatch(/Anexos não importados .*: programa\.exe<\/p>$/);
    });

    it.each([
      ['gmail-reply.eml', 'Ainda não funciona, testei de novo.'],
      ['outlook-reply.eml', 'Resolvido, obrigado!'],
      ['texto-reply.eml', 'Funcionou depois de reiniciar.'],
    ])('CT-17 %s: texto novo no corpo, citação em quoted_html', async (file, newText) => {
      const ticket = await ticketWithOurRef('open');
      await drop(await fixture(file));
      await poll();
      const reply = (await messagesOf(ticket.id))[1]!;
      expect(reply.bodyHtml).toContain(newText);
      expect(reply.bodyHtml).not.toContain('Troque o toner');
      expect(reply.quotedHtml).toContain('Troque o toner');
    });

    it('CT-18 texto puro com <script>: escapado', async () => {
      const ticket = await ticketWithOurRef('open');
      await drop(await fixture('texto-reply.eml'));
      await poll();
      const reply = (await messagesOf(ticket.id))[1]!;
      expect(reply.bodyHtml).toContain('&lt;script&gt;');
      expect(reply.bodyHtml).not.toContain('<script');
    });

    it('CT-19 só uma imagem colada: corpo "(e-mail sem texto)" e a imagem como anexo', async () => {
      const png = Buffer.from('\x89PNG teste').toString('base64');
      await drop(
        eml({
          from: email('req1'),
          contentType: 'multipart/related; boundary="r"',
          body: [
            '--r',
            'Content-Type: text/html',
            '',
            '<div><img src="cid:a@b"></div>',
            '--r',
            'Content-Type: image/png',
            'Content-ID: <a@b>',
            'Content-Transfer-Encoding: base64',
            '',
            png,
            '--r--',
          ].join('\n'),
        }),
      );
      await poll();
      const [message] = await messagesOf((await t.prisma.ticket.findFirstOrThrow()).id);
      expect(message!.bodyHtml).toBe('<p>(e-mail sem texto)</p>');
      expect(message!.attachments).toHaveLength(1);
    });

    it('CT-20 primeira execução com MAILBOX_START_SINCE: os anteriores não viram ticket', async () => {
      await drop(at('Tue, 27 Oct 2026 07:00:00 -0400'));
      await drop(at('Tue, 27 Oct 2026 07:20:00 -0400'));
      await drop(at('Tue, 27 Oct 2026 08:00:00 -0400'));
      const source = new FolderMailboxSource(INBOX, new Date('2026-10-27T07:15:00-04:00'));
      expect((await inbound.pollMailbox(source)).processed).toBe(2);
      expect(await t.prisma.ticket.count()).toBe(2);
      expect(await readdir(join(INBOX, 'ignorado'))).toHaveLength(1);
    });

    it('CT-21 nenhum log com corpo, nome de anexo ou e-mail do remetente', async () => {
      const logs: string[] = [];
      for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(' '));
        });
      }
      await drop(await fixture('com-anexos.eml'));
      await drop(eml({ from: 'a@x.org', headers: ['Precedence: bulk'], body: 'Segredo do corpo' }));
      await drop('Subject: sem from\n\nSegredo do corpo\n');
      await poll();
      const all = logs.join('\n');
      expect(logs.length).toBeGreaterThan(0);
      expect(all).not.toMatch(/Segue o print|Segredo do corpo|relatório|programa\.exe/);
      expect(all).not.toMatch(/novo@missaosalesiana|a@x\.org/);
    });
  });
});
