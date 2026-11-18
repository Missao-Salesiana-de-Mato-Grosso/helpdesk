// Spec docs/specs/T14-notifications.md — outbox, destinatários, entrega e cabeçalhos.
import { Logger } from '@nestjs/common';
import type { TicketDetail } from '@helpdesk/shared';
import request, { type Response } from 'supertest';
import {
  MAILER,
  NodemailerMailer,
  type Mailer,
  type OutgoingMail,
} from '../src/notifications/mailer.js';
import { NotificationService } from '../src/notifications/notification.service.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import {
  createTicketsFixture,
  type FixtureUser,
  type TicketsFixture,
} from './setup/tickets-fixture.js';

type Login = Exclude<FixtureUser, 'ext1'>;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- corpo do Supertest é `any`.
const detailOf = (res: Response) => res.body as TicketDetail;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- payload gravado pelo enqueue.
const payloadOf = (row: { payload: unknown }) => row.payload as Record<string, unknown>;
/** T32: resposta com uma imagem no texto (o arquivo vai no campo `inline`). */
const withImage = (kind = 'public') => ({
  kind,
  bodyHtml: '<p>Veja:</p><img data-inline-key="a" alt="tela">',
  inlineImages: ['a'],
});

const MAILPIT = 'http://127.0.0.1:8025/api/v1';
const OWN = 'suporte@missaosalesiana.org.br';
const timeout = () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
const email = (user: FixtureUser) => `${user}@missaosalesiana.org.br`;

/**
 * Dublê do SMTP: grava o que seria enviado, falha quando há erro na fila e, com `smtp = true`,
 * entrega de verdade no Mailpit (CTs 📬).
 */
class TestMailer implements Mailer {
  sent: OutgoingMail[] = [];
  failures: unknown[] = [];
  smtp = false;
  private readonly real = new NodemailerMailer({ host: '127.0.0.1', port: 1025, secure: false });

  async send(mail: OutgoingMail): Promise<void> {
    const failure = this.failures.shift();
    if (failure !== undefined) {
      for (const a of mail.attachments) a.content.destroy();
      throw failure;
    }
    if (this.smtp) await this.real.send(mail);
    else for (const a of mail.attachments) a.content.destroy();
    this.sent.push(mail);
  }

  reset(): void {
    this.sent = [];
    this.failures = [];
    this.smtp = false;
  }
}

interface MailpitSummary {
  ID: string;
  MessageID: string;
}
interface MailpitMessage {
  Subject: string;
  From: { Address: string };
  ReplyTo: { Address: string }[];
  To: { Address: string }[];
  Attachments: { FileName: string; Size: number }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mailpit ${res.status} em ${url}`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- formato da API do Mailpit.
  return (await res.json()) as T;
}

/** E-mail entregue no Mailpit pelo Message-ID, com os cabeçalhos em minúsculas. */
async function mailpit(messageId: string) {
  const bare = messageId.replace(/^<|>$/g, '');
  const list = await getJson<{ messages: MailpitSummary[] }>(`${MAILPIT}/messages?limit=200`);
  const found = list.messages.find((m) => m.MessageID === bare);
  if (!found) throw new Error(`E-mail ${messageId} não chegou ao Mailpit`);
  const [message, rawHeaders] = await Promise.all([
    getJson<MailpitMessage>(`${MAILPIT}/message/${found.ID}`),
    getJson<Record<string, string[]>>(`${MAILPIT}/message/${found.ID}/headers`),
  ]);
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).map(([key, values]) => [key.toLowerCase(), values.join(' ')]),
  );
  return { message, headers };
}

describe('notificações — T14 (e2e)', () => {
  let t: TestApp;
  let f: TicketsFixture;
  let outbox: NotificationService;
  const mailer = new TestMailer();

  beforeAll(async () => {
    t = await createTestApp({ providers: [{ provide: MAILER, useValue: mailer }] });
    outbox = t.app.get(NotificationService);
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    vi.restoreAllMocks();
    mailer.reset();
    f = await createTicketsFixture(t);
  });

  const http = () => request(t.app.getHttpServer());
  const as = async (user: Login) => `Bearer ${await f.token(user)}`;
  const create = async (user: Login, body: object = {}) =>
    http()
      .post('/api/tickets')
      .set('Authorization', await as(user))
      .send({
        subject: 'Impressora da secretaria',
        bodyHtml: '<p>Não imprime</p>',
        categoryId: f.C1,
        ...body,
      });
  const message = async (user: Login, id: string, body: object) =>
    http()
      .post(`/api/tickets/${id}/messages`)
      .set('Authorization', await as(user))
      .send(body);
  const patch = async (user: Login, id: string, body: object) =>
    http()
      .patch(`/api/tickets/${id}`)
      .set('Authorization', await as(user))
      .send(body);
  const reply = { kind: 'public', bodyHtml: '<p>Troque o toner</p>' };
  const replyWithFile = async (user: Login, id: string) =>
    http()
      .post(`/api/tickets/${id}/messages`)
      .set('Authorization', await as(user))
      .field('data', JSON.stringify(reply))
      .attach('files', Buffer.from('conteúdo do log'), 'servidor.log.txt');
  const rows = () =>
    t.prisma.notification.findMany({ orderBy: [{ createdAt: 'asc' }, { toEmail: 'asc' }] });
  const sent = async () => (await rows()).map((n) => [n.template, n.toEmail]);
  const signWithLogo = async (html = '<p>Ag Um</p>') =>
    http()
      .put('/api/me/signature')
      .set('Authorization', await as('ag1'))
      .field(
        'data',
        JSON.stringify({
          signatureHtml: `${html}<img data-inline-key="logo" alt="logo">`,
          inlineImages: ['logo'],
        }),
      )
      .attach('inline', Buffer.from('logo de teste'), 'logo.png');
  const logoId = async () => (await t.prisma.signatureImage.findFirstOrThrow()).id;
  const imageIdOf = async () =>
    (await t.prisma.attachment.findFirstOrThrow({ where: { inline: true } })).id;
  const addToG1 = (user: FixtureUser) =>
    t.prisma.groupMember.create({ data: { groupId: f.G1, userId: f.users[user] } });

  describe('quem recebe (RN-01 a RN-08)', () => {
    it('CT-01 ticket criado: confirmação ao solicitante e aviso a cada agente do grupo', async () => {
      const res = await create('req1');
      expect(res.status).toBe(201);
      const created = await rows();
      expect(created.map((n) => [n.template, n.toEmail, n.status])).toEqual([
        ['ticket_created_group', email('ag1'), 'pending'],
        ['ticket_created', email('req1'), 'pending'],
      ]);
      const confirmation = created.find((n) => n.template === 'ticket_created')!;
      expect(confirmation.ticketId).toBe(detailOf(res).id);
      expect(confirmation.emailMessageId).toMatch(
        new RegExp(`^<tk-${detailOf(res).id}-[0-9a-f-]{36}@helpdesk\\.test>$`),
      );
      expect(confirmation.payload).toMatchObject({
        ticketNumber: 1001,
        ticketSubject: 'Impressora da secretaria',
        recipientName: 'req1',
        portalUrl: `http://portal.test/tickets/${detailOf(res).id}`,
        bodyHtml: '<p>Não imprime</p>',
      });
    });

    it('CT-02 grupo com e-mail próprio: o aviso vai para ele, não para os membros', async () => {
      await t.prisma.group.update({ where: { id: f.G1 }, data: { email: 'fila-ti@x.org' } });
      await create('req1');
      expect(await sent()).toContainEqual(['ticket_created_group', 'fila-ti@x.org']);
      expect(await sent()).not.toContainEqual(['ticket_created_group', email('ag1')]);
    });

    it('CT-03 grupo com o e-mail da própria caixa: cai para os membros, nunca para suporte@', async () => {
      await t.prisma.group.update({ where: { id: f.G1 }, data: { email: OWN.toUpperCase() } });
      await create('req1');
      expect(await sent()).toContainEqual(['ticket_created_group', email('ag1')]);
      expect((await rows()).map((n) => n.toEmail.toLowerCase())).not.toContain(OWN);
    });

    it('CT-04 agente abre para um terceiro: confirmação sem link do portal; nada para o agente', async () => {
      const res = await create('ag1', { requesterId: f.users.ext1 });
      expect(res.status).toBe(201);
      expect(await sent()).toEqual([['ticket_created', email('ext1')]]);
      expect((await rows())[0]!.payload).toMatchObject({ portalUrl: null, authorName: 'ag1' });
    });

    it('CT-05 resposta pública do agente → solicitante, com o corpo', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      expect((await message('ag1', ticket.id, reply)).status).toBe(201);
      const created = await rows();
      expect(created.map((n) => [n.template, n.toEmail])).toEqual([['reply', email('req1')]]);
      expect(created[0]!.payload).toMatchObject({
        authorName: 'ag1',
        bodyHtml: '<p>Troque o toner</p>',
        resolved: false,
      });
    });

    it('CT-06 resposta do solicitante sem responsável → agentes do grupo', async () => {
      await addToG1('sup');
      const ticket = await f.ticket({ requester: 'req1' });
      await message('req1', ticket.id, reply);
      expect(await sent()).toEqual([
        ['requester_reply', email('ag1')],
        ['requester_reply', email('sup')],
      ]);
    });

    it('CT-07 resposta do solicitante com responsável → só o responsável', async () => {
      const ticket = await f.ticket({ requester: 'req1', assignee: 'ag2' });
      await message('req1', ticket.id, reply);
      expect(await sent()).toEqual([['requester_reply', email('ag2')]]);
    });

    it('CT-08 nota interna não gera e-mail', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      expect(
        (await message('ag1', ticket.id, { kind: 'internal', bodyHtml: '<p>Nota</p>' })).status,
      ).toBe(201);
      expect(await rows()).toEqual([]);
    });

    it('CT-09 PATCH para resolvido → aviso ao solicitante', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      expect((await patch('ag1', ticket.id, { version: 1, status: 'resolved' })).status).toBe(200);
      const created = await rows();
      expect(created.map((n) => [n.template, n.toEmail])).toEqual([['resolved', email('req1')]]);
      expect(created[0]!.payload).toMatchObject({ bodyHtml: null });
    });

    it('CT-10 responder e resolver: um e-mail só, o reply com resolved = true', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, { ...reply, status: 'resolved', version: 1 });
      const created = await rows();
      expect(created.map((n) => n.template)).toEqual(['reply']);
      expect(created[0]!.payload).toMatchObject({ resolved: true });
    });

    it('nota interna que resolve → aviso de resolvido, sem o texto da nota', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, {
        kind: 'internal',
        bodyHtml: '<p>Só a equipe</p>',
        status: 'resolved',
        version: 1,
      });
      const created = await rows();
      expect(created.map((n) => n.template)).toEqual(['resolved']);
      expect(JSON.stringify(created[0]!.payload)).not.toContain('Só a equipe');
    });

    it('CT-11 prioridade, responsável, pendente, grupo e fechado não geram e-mail', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      let version = 1;
      for (const change of [
        { priority: 'high' },
        { assigneeId: f.users.ag1 },
        { status: 'pending' },
        { groupId: f.G2 },
      ]) {
        const res = await patch('sup', ticket.id, { version, ...change });
        expect(res.status).toBe(200);
        version = detailOf(res).version;
      }
      const resolved = await f.ticket({ requester: 'req1', status: 'resolved' });
      expect((await patch('sup', resolved.id, { version: 1, status: 'closed' })).status).toBe(200);
      expect(await rows()).toEqual([]);
    });

    it('CT-12 transação que falha não deixa linha na outbox', async () => {
      const ticket = await f.ticket({ requester: 'req1', status: 'closed' });
      const res = await message('req1', ticket.id, reply);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await rows()).toEqual([]);
    });

    it('RN-06 usuário inativo e endereço repetido ficam de fora', async () => {
      await addToG1('sup');
      await t.prisma.user.update({ where: { id: f.users.sup }, data: { active: false } });
      const ticket = await f.ticket({ requester: 'req1' });
      await message('req1', ticket.id, reply);
      expect(await sent()).toEqual([['requester_reply', email('ag1')]]);
    });

    it('agente que responde o próprio chamado não recebe cópia', async () => {
      const ticket = await f.ticket({ requester: 'ag1' });
      await message('ag1', ticket.id, reply);
      expect(await rows()).toEqual([]);
    });
  });

  describe('entrega (RN-11 a RN-15)', () => {
    it('CT-13 📬 cabeçalhos de thread, From/Reply-To e ref outbound gravada', async () => {
      mailer.smtp = true;
      const ticket = await f.ticket({ requester: 'req1', subject: 'Sem internet' });
      await t.prisma.emailMessageRef.create({
        data: { messageId: '<a@x.org>', ticketId: ticket.id, direction: 'inbound' },
      });
      await message('ag1', ticket.id, reply);
      expect(await outbox.processOutbox()).toEqual({ sent: 1, failed: 0, retried: 0 });

      const [row] = await rows();
      expect(row).toMatchObject({ status: 'sent', attempts: 0 });
      expect(row!.sentAt).toBeInstanceOf(Date);
      const { message: mail, headers } = await mailpit(row!.emailMessageId!);
      expect(mail.Subject).toBe(`[#${ticket.number}] Sem internet`);
      expect(mail.From.Address).toBe(OWN);
      expect(mail.ReplyTo.map((r) => r.Address)).toEqual([OWN]);
      expect(mail.To.map((r) => r.Address)).toEqual([email('req1')]);
      expect(headers['message-id']).toBe(row!.emailMessageId);
      expect(headers['in-reply-to']).toBe('<a@x.org>');
      expect(headers['references']).toBe('<a@x.org>');
      expect(headers['auto-submitted']).toBeUndefined();
      expect(headers['x-helpdesk-ticket']).toBe(String(ticket.number));

      const refs = await t.prisma.emailMessageRef.findMany({
        where: { ticketId: ticket.id, direction: 'outbound' },
      });
      expect(refs.map((r) => r.messageId)).toEqual([row!.emailMessageId]);
    });

    it('CT-14 📬 ticket sem refs: sem In-Reply-To; automático com Auto-Submitted', async () => {
      mailer.smtp = true;
      await create('req1');
      await outbox.processOutbox();
      const confirmation = (await rows()).find((n) => n.template === 'ticket_created')!;
      const { headers } = await mailpit(confirmation.emailMessageId!);
      expect(headers['in-reply-to']).toBeUndefined();
      expect(headers['references']).toBeUndefined();
      expect(headers['auto-submitted']).toBe('auto-generated');
    });

    it('o thread é por destinatário: o aviso ao grupo não entra no do solicitante', async () => {
      await create('req1');
      await outbox.processOutbox();
      const ticketId = (await rows())[0]!.ticketId!;
      await message('ag1', ticketId, reply);
      await outbox.processOutbox();
      const toReq1 = mailer.sent.filter((m) => m.to === email('req1'));
      expect(toReq1.map((m) => m.subject)).toHaveLength(2);
      expect(toReq1[1]!.references).toEqual([toReq1[0]!.messageId]);
      const toGroup = mailer.sent.find((m) => m.to === email('ag1'))!;
      expect(toReq1[1]!.references).not.toContain(toGroup.messageId);
    });

    it('o segundo e-mail do ticket responde ao primeiro', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await outbox.processOutbox();
      await message('ag1', ticket.id, { kind: 'public', bodyHtml: '<p>Outra</p>' });
      await outbox.processOutbox();
      const [first, second] = mailer.sent;
      expect(second!.inReplyTo).toBe(first!.messageId);
      expect(second!.references).toEqual([first!.messageId]);
    });

    it('CT-15 falha temporária: attempts, last_error e backoff de 1 e 2 min', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      mailer.failures.push(timeout(), timeout());

      const first = new Date(Date.now() + 1000);
      expect(await outbox.processOutbox(first)).toEqual({ sent: 0, failed: 0, retried: 1 });
      let [row] = await rows();
      expect(row!.sendAfter.getTime()).toBe(first.getTime() + 60_000);

      expect((await outbox.processOutbox(first)).retried).toBe(0);
      const second = new Date(first.getTime() + 60_000);
      await outbox.processOutbox(second);
      [row] = await rows();
      expect(row).toMatchObject({
        status: 'pending',
        attempts: 2,
        lastError: 'ETIMEDOUT Connection timeout',
      });
      expect(row!.sendAfter.getTime()).toBe(second.getTime() + 2 * 60_000);
    });

    it('CT-16 recusa 5xx → failed na hora', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      mailer.failures.push(Object.assign(new Error('No such user'), { responseCode: 550 }));
      expect(await outbox.processOutbox()).toEqual({ sent: 0, failed: 1, retried: 0 });
      expect((await rows())[0]).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: '550 No such user',
      });
    });

    it('CT-17 a 6ª falha temporária desiste', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await t.prisma.notification.updateMany({ data: { attempts: 5 } });
      mailer.failures.push(Object.assign(new Error('Try later'), { responseCode: 421 }));
      expect(await outbox.processOutbox()).toEqual({ sent: 0, failed: 1, retried: 0 });
      expect((await rows())[0]).toMatchObject({ status: 'failed', attempts: 6 });
    });

    it('CT-18 uma falha não interrompe o lote', async () => {
      for (const subject of ['Um', 'Dois', 'Três']) {
        const ticket = await f.ticket({ requester: 'req1', subject });
        await message('ag1', ticket.id, reply);
      }
      // A 1ª passa (`undefined`), a 2ª falha, a 3ª passa.
      mailer.failures.push(undefined, new Error('boom'));
      expect(await outbox.processOutbox()).toEqual({ sent: 2, failed: 0, retried: 1 });
      expect(mailer.sent.map((m) => m.subject.replace(/^\[#\d+\] /, ''))).toEqual(['Um', 'Três']);
      expect((await rows()).map((n) => n.status)).toEqual(['sent', 'pending', 'sent']);
    });

    it('CT-19 linha com send_after no futuro não sai', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await t.prisma.notification.updateMany({
        data: { sendAfter: new Date(Date.now() + 10 * 60_000) },
      });
      expect(await outbox.processOutbox()).toEqual({ sent: 0, failed: 0, retried: 0 });
      expect(mailer.sent).toEqual([]);
    });

    it('CT-20 dois ciclos em paralelo enviam cada linha uma vez', async () => {
      for (let i = 0; i < 5; i += 1) {
        const ticket = await f.ticket({ requester: 'req1' });
        await message('ag1', ticket.id, reply);
      }
      const [a, b] = await Promise.all([outbox.processOutbox(), outbox.processOutbox()]);
      expect(a.sent + b.sent).toBe(5);
      const ids = mailer.sent.map((m) => m.messageId);
      expect(new Set(ids).size).toBe(5);
      expect(ids).toHaveLength(5);
    });

    it('reenvio após queda usa o mesmo Message-ID e não duplica a ref', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await outbox.processOutbox();
      // Simula a queda: a linha volta a pendente depois de enviada.
      await t.prisma.notification.updateMany({
        data: { status: 'pending', sendAfter: new Date(0) },
      });
      await outbox.processOutbox();
      expect(mailer.sent[0]!.messageId).toBe(mailer.sent[1]!.messageId);
      expect(await t.prisma.emailMessageRef.count({ where: { direction: 'outbound' } })).toBe(1);
    });
  });

  describe('conteúdo (RN-10, RN-19, RN-20)', () => {
    it('CT-21 📬 anexo da mensagem vai no e-mail com o nome original', async () => {
      mailer.smtp = true;
      const ticket = await f.ticket({ requester: 'req1' });
      expect((await replyWithFile('ag1', ticket.id)).status).toBe(201);
      await outbox.processOutbox();
      const [row] = await rows();
      const { message: mail } = await mailpit(row!.emailMessageId!);
      expect(mail.Attachments.map((a) => [a.FileName, a.Size])).toEqual([
        ['servidor.log.txt', Buffer.byteLength('conteúdo do log')],
      ]);
    });

    it('CT-22 anexos acima do limite: só os nomes no corpo', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await replyWithFile('ag1', ticket.id);
      const [row] = await rows();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- payload gravado pelo enqueue.
      const payload = row!.payload as { attachments: { sizeBytes: number }[] };
      payload.attachments[0]!.sizeBytes = 30 * 1024 * 1024;
      await t.prisma.notification.update({ where: { id: row!.id }, data: { payload } });
      await outbox.processOutbox();
      expect(mailer.sent[0]!.attachments).toEqual([]);
      expect(mailer.sent[0]!.text).toContain('disponíveis no portal): servidor.log.txt.');
    });

    it('CT-23 o e-mail usa o que foi gravado no enqueue', async () => {
      const res = await create('req1', { subject: 'Original' });
      await t.prisma.ticket.update({
        where: { id: detailOf(res).id },
        data: { subject: 'Trocado depois', groupId: f.G2 },
      });
      await outbox.processOutbox();
      expect(
        mailer.sent.map((m) => [m.subject, m.to]).toSorted((a, b) => a[1]!.localeCompare(b[1]!)),
      ).toEqual([
        ['[#1001] Original', email('ag1')],
        ['[#1001] Original', email('req1')],
      ]);
    });

    it('CT-24 nenhum log com corpo da mensagem ou payload', async () => {
      const logs: string[] = [];
      for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(' '));
        });
      }
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, { kind: 'public', bodyHtml: '<p>Senha do wifi: xyz</p>' });
      await message('ag1', ticket.id, { kind: 'public', bodyHtml: '<p>Senha do wifi: xyz</p>' });
      mailer.failures.push(new Error('Connection timeout'));
      await outbox.processOutbox();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain('wifi');
      expect(logs.join('\n')).not.toContain(email('req1'));
    });
  });

  // Spec docs/specs/T31-assinatura-email.md — a assinatura do agente no `reply`.
  describe('imagens no texto (T32)', () => {
    const png = Buffer.from('imagem de teste');
    const post = async (user: Login, path: string, data: object, withFile = false) => {
      let req = http()
        .post(path)
        .set('Authorization', await as(user))
        .field('data', JSON.stringify(data))
        .attach('inline', png, 'print.png');
      if (withFile) req = req.attach('files', Buffer.from('log'), 'servidor.log.txt');
      return req;
    };
    type StoredPayload = { attachments: { sizeBytes: number; inline?: boolean }[] };
    const inflate = async (which: 'inline' | 'regular') => {
      const [row] = await rows();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- payload gravado pelo enqueue.
      const payload = row!.payload as StoredPayload;
      for (const a of payload.attachments) {
        if ((which === 'inline') === (a.inline === true)) a.sizeBytes = 30 * 1024 * 1024;
      }
      await t.prisma.notification.update({ where: { id: row!.id }, data: { payload } });
    };

    it('T32 CT-11 reply: imagem embutida por cid e [imagem: nome] no texto', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      expect((await post('ag1', `/api/tickets/${ticket.id}/messages`, withImage())).status).toBe(
        201,
      );
      const id = await imageIdOf();
      expect(payloadOf((await rows())[0]!)).toMatchObject({
        attachments: [expect.objectContaining({ id, inline: true, filename: 'print.png' })],
      });

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      const cid = mail!.attachments[0]!.cid!;
      expect(cid.startsWith(`${id}@`)).toBe(true);
      expect(mail!.html).toContain(`<img src="cid:${cid}" alt="tela"`);
      expect(mail!.html).not.toContain('data-attachment-id');
      expect(mail!.text).toContain('Veja:\n[imagem: print.png]');
    });

    it('T32 CT-12 requester_reply e ticket_created_group também embutem a imagem', async () => {
      const ticket = await f.ticket({ requester: 'req1', assignee: 'ag1' });
      await post('req1', `/api/tickets/${ticket.id}/messages`, withImage());
      await post('req1', '/api/tickets', {
        subject: 'Com print',
        categoryId: f.C1,
        bodyHtml: '<img data-inline-key="a">',
        inlineImages: ['a'],
      });

      await outbox.processOutbox();
      const byTemplate = new Map(
        (await rows()).map((row) => [row.template, row.emailMessageId] as const),
      );
      for (const template of ['requester_reply', 'ticket_created_group']) {
        const mail = mailer.sent.find((m) => m.messageId === byTemplate.get(template));
        expect(mail, template).toBeDefined();
        expect(mail!.attachments.some((a) => a.cid)).toBe(true);
        expect(mail!.html).toContain('src="cid:');
      }
    });

    it('T32 CT-13 imagem cabe no teto e os anexos comuns não: só a imagem vai', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await post('ag1', `/api/tickets/${ticket.id}/messages`, withImage(), true);
      await inflate('regular');

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      expect(mail!.attachments.map((a) => [a.filename, Boolean(a.cid)])).toEqual([
        ['print.png', true],
      ]);
      expect(mail!.text).toContain('servidor.log.txt');
      expect(mail!.html).toContain('src="cid:');
    });

    it('T32 CT-14 imagem acima do teto: texto no lugar e aviso', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await post('ag1', `/api/tickets/${ticket.id}/messages`, withImage());
      await inflate('inline');

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      expect(mail!.attachments).toEqual([]);
      expect(mail!.html).not.toContain('<img');
      expect(mail!.html).toContain('[imagem: print.png]');
      expect(mail!.text).toContain('Imagens grandes demais para o e-mail, disponíveis no portal.');
    });
  });

  describe('imagem na assinatura (T33)', () => {
    it('T33 CT-07 resposta pelo portal: logo congelado no payload e embutido no e-mail', async () => {
      expect((await signWithLogo()).status).toBe(200);
      const id = await logoId();
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);

      const [row] = await rows();
      expect(payloadOf(row!)).toMatchObject({
        signatureImages: [expect.objectContaining({ id, filename: 'logo.png' })],
      });
      await outbox.processOutbox();
      const [mail] = mailer.sent;
      const embedded = mail!.attachments.find((a) => a.cid?.startsWith(`sig-${id}@`));
      expect(embedded).toBeDefined();
      expect(mail!.html).toContain(`<img src="cid:${embedded!.cid}" alt="logo"`);
      expect(mail!.text).toContain('-- \nAg Um');
      expect(mail!.text).not.toContain('imagem');
    });

    it('T33 CT-08 trocar a assinatura depois do enqueue: o e-mail sai com o logo antigo', async () => {
      await signWithLogo();
      const oldId = await logoId();
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await http()
        .put('/api/me/signature')
        .set('Authorization', await as('ag1'))
        .send({ signatureHtml: '<p>Sem logo</p>' });

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      expect(mail!.attachments.some((a) => a.cid?.startsWith(`sig-${oldId}@`))).toBe(true);
      expect(mail!.html).not.toContain('Sem logo');
    });

    it('T33 CT-09 imagens da assinatura acima do teto: texto da assinatura sem o logo', async () => {
      await signWithLogo();
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      const [row] = await rows();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- payload gravado pelo enqueue.
      const payload = row!.payload as { signatureImages: { sizeBytes: number }[] };
      payload.signatureImages[0]!.sizeBytes = 30 * 1024 * 1024;
      await t.prisma.notification.update({ where: { id: row!.id }, data: { payload } });

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      expect(mail!.attachments).toEqual([]);
      expect(mail!.html).toContain('Ag Um');
      expect(mail!.html).not.toContain('cid:sig-');
    });
  });

  describe('assinatura do agente (T31)', () => {
    const SIGNATURE = '<p><strong>Ag Um</strong></p><p>Suporte de TI</p>';
    const sign = (user: FixtureUser, signatureHtml: string | null = SIGNATURE) =>
      t.prisma.user.update({ where: { id: f.users[user] }, data: { signatureHtml } });

    it('T31 CT-07 resposta pelo portal: assinatura no payload e depois do corpo, no HTML e no texto', async () => {
      await sign('ag1');
      const ticket = await f.ticket({ requester: 'req1' });
      expect((await message('ag1', ticket.id, reply)).status).toBe(201);

      const [row] = await rows();
      expect(row!.template).toBe('reply');
      expect(payloadOf(row!)).toMatchObject({ signatureHtml: SIGNATURE });

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      expect(mail!.html).toContain(
        `<p>Troque o toner</p><div style="margin:16px 0 0">${SIGNATURE}</div></div>`,
      );
      expect(mail!.text).toContain('Troque o toner\n\n-- \nAg Um\nSuporte de TI\n\nResponda');
    });

    it('T31 CT-08 agente sem assinatura: e-mail como antes', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      const [row] = await rows();
      expect(payloadOf(row!)).not.toHaveProperty('signatureHtml');

      await outbox.processOutbox();
      const [mail] = mailer.sent;
      expect(mail!.html).toContain('<p>Troque o toner</p></div>');
      expect(mail!.text).not.toContain('-- \n');
    });

    it('T31 CT-10 nota interna, chamado aberto pelo agente, resolver sem texto e agente como solicitante: sem assinatura', async () => {
      await sign('ag1');
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, { kind: 'internal', bodyHtml: '<p>Só a equipe</p>' });
      await patch('ag1', ticket.id, { status: 'resolved', version: 1 });
      await create('ag1', { requesterId: f.users.ext1 });
      const own = await f.ticket({ requester: 'ag1', assignee: 'ag2', group: 'G2' });
      await message('ag1', own.id, reply);

      const created = await rows();
      expect(created.map((n) => n.template).toSorted()).toEqual([
        'requester_reply',
        'resolved',
        'ticket_created',
      ]);
      for (const row of created) expect(payloadOf(row)).not.toHaveProperty('signatureHtml');
    });

    it('T31 CT-11 trocar a assinatura depois do enqueue não muda o e-mail pendente', async () => {
      await sign('ag1', '<p>Assinatura A</p>');
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await sign('ag1', '<p>Assinatura B</p>');

      await outbox.processOutbox();
      expect(mailer.sent[0]!.html).toContain('Assinatura A');
      expect(mailer.sent[0]!.html).not.toContain('Assinatura B');
    });

    it('T31 CT-12 linha antiga da outbox, sem signatureHtml no payload, continua sendo enviada', async () => {
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      const [row] = await rows();
      expect(payloadOf(row!)).not.toHaveProperty('signatureHtml');
      await sign('ag1');

      expect(await outbox.processOutbox()).toEqual({ sent: 1, failed: 0, retried: 0 });
      expect(mailer.sent[0]!.html).not.toContain('Suporte de TI');
    });

    it('T31 CT-13 responder e resolver: a assinatura vem antes do aviso de resolução', async () => {
      await sign('ag1');
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, { ...reply, status: 'resolved', version: 1 });
      expect((await rows()).map((n) => n.template)).toEqual(['reply']);

      await outbox.processOutbox();
      for (const part of [mailer.sent[0]!.html, mailer.sent[0]!.text]) {
        expect(part.indexOf('Suporte de TI')).toBeGreaterThan(part.indexOf('Troque o toner'));
        expect(part.indexOf('Suporte de TI')).toBeLessThan(
          part.indexOf('Marcamos este chamado como resolvido'),
        );
      }
    });

    it('T31 CT-14 a mensagem gravada no ticket não contém a assinatura', async () => {
      await sign('ag1');
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);

      const stored = await t.prisma.ticketMessage.findMany({ where: { ticketId: ticket.id } });
      expect(stored.map((m) => m.bodyHtml).toSorted()).toEqual([
        '<p>Corpo</p>',
        '<p>Troque o toner</p>',
      ]);
      const detail = await http()
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', await as('req1'));
      expect(JSON.stringify(detail.body)).not.toContain('Suporte de TI');
    });

    it('T31 CT-15 nenhum log com o texto da assinatura', async () => {
      const logs: string[] = [];
      for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(' '));
        });
      }
      const saved = await http()
        .put('/api/me/signature')
        .set('Authorization', await as('ag1'))
        .send({ signatureHtml: '<p>Ramal secreto 4321</p>' });
      expect(saved.status).toBe(200);
      const ticket = await f.ticket({ requester: 'req1' });
      await message('ag1', ticket.id, reply);
      await message('ag1', ticket.id, reply);
      mailer.failures.push(new Error('Connection timeout'));
      await outbox.processOutbox();

      expect(mailer.sent[0]!.html).toContain('Ramal secreto 4321');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain('4321');
    });
  });
});
