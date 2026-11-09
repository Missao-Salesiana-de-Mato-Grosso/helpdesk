// T29: import dos chamados abertos do Freshdesk, com um pacote montado numa pasta temporária.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CATEGORY_NAME } from '@helpdesk/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_GROUP_RULES } from '../src/import/freshdesk-bundle.js';
import { FreshdeskImportModule } from '../src/import/freshdesk-import.module.js';
import {
  FreshdeskImportService,
  type ImportOptions,
} from '../src/import/freshdesk-import.service.js';
import { SYSTEM_USER_EMAIL } from '../src/users/system-user.js';
import { createTestApp, type TestApp } from './setup/auth.js';
import { truncateAll } from './setup/db.js';
import { createTicketsFixture, type TicketsFixture } from './setup/tickets-fixture.js';

const MINUTE_MS = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS).toISOString();

// PNG de 1×1.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('import do Freshdesk (T29, e2e)', () => {
  let t: TestApp;
  // O import tem módulo próprio (fora do AppModule), como na linha de comando.
  let importer: INestApplicationContext;
  let f: TicketsFixture;
  let dir: string;
  let systemId: string;
  let cadastrosId: string;

  beforeAll(async () => {
    t = await createTestApp();
    importer = await NestFactory.createApplicationContext(FreshdeskImportModule, { logger: false });
  });

  afterAll(async () => {
    await importer.close();
    await t.app.close();
  });

  beforeEach(async () => {
    await truncateAll(t.prisma);
    t.cache.clear();
    f = await createTicketsFixture(t);
    systemId = (
      await t.prisma.user.create({
        data: { email: SYSTEM_USER_EMAIL, name: 'Sistema', active: false },
      })
    ).id;
    await t.prisma.category.create({ data: { name: DEFAULT_CATEGORY_NAME, defaultGroupId: f.G1 } });
    cadastrosId = (await t.prisma.group.create({ data: { name: 'Cadastros' } })).id;
    await t.prisma.slaPolicy.create({
      data: { priority: 'medium', firstResponseMinutes: 480, resolutionMinutes: 1440 },
    });
    await t.prisma.businessHours.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
    });

    dir = await mkdtemp(path.join(tmpdir(), 'freshdesk-bundle-'));
    await mkdir(path.join(dir, 'files', '101'), { recursive: true });
    await writeFile(path.join(dir, 'files', '101', '9-orcamento.pdf'), '%PDF-1.4 teste');
    await writeFile(path.join(dir, 'files', '101', 'inline-1.png'), PNG);
    await writeFile(path.join(dir, 'files', '101', '10-programa.exe'), 'MZ');
    // Chamado daqui que também chegou ao Freshdesk (o `suporte@` encaminhava para lá).
    await f.ticket({ requester: 'req1', subject: 'Impressora parada' });
    await writeFile(
      path.join(dir, 'bundle.json'),
      JSON.stringify({
        version: 1,
        tickets: [
          {
            freshdeskId: 101,
            subject: 'Cadastro de fornecedor',
            status: 'open',
            priority: 1,
            source: 'email',
            createdAt: ago(2 * 24 * 60),
            updatedAt: ago(60),
            group: null,
            toEmails: ['cadastros@missaosalesiana.org.br'],
            requester: { email: 'compras@fornecedor.com.br', name: 'Compras Fornecedor' },
            responder: { email: 'ag1@missaosalesiana.org.br', name: 'ag1' },
            html: '<p>Segue o print:</p><img src="fd-inline:101/inline-1.png"><script>x</script>',
            attachments: [
              { file: '101/9-orcamento.pdf', name: 'orçamento.pdf' },
              { file: '101/10-programa.exe', name: 'programa.exe' },
            ],
            messages: [
              {
                createdAt: ago(24 * 60),
                private: false,
                author: { email: 'ag1@missaosalesiana.org.br', name: 'ag1' },
                html: '<p>Recebido.</p><div class="freshdesk_quote"><p>Segue o print</p></div>',
                attachments: [],
              },
              {
                createdAt: ago(23 * 60),
                private: true,
                author: { email: 'ag1@missaosalesiana.org.br', name: 'ag1' },
                html: '<p>Falta o CNPJ.</p>',
                attachments: [],
              },
            ],
          },
          {
            freshdeskId: 102,
            subject: 'Acesso ao sistema',
            status: 'pending',
            priority: 3,
            source: 'portal',
            createdAt: ago(3 * 24 * 60),
            updatedAt: ago(120),
            group: 'Suporte TI - Sede Inspetorial',
            toEmails: [],
            requester: { email: 'req1@missaosalesiana.org.br', name: 'req1' },
            responder: null,
            html: '<p>Não consigo entrar.</p>',
            attachments: [],
            messages: [],
          },
          {
            freshdeskId: 103,
            subject: 'RE: Impressora parada',
            status: 'open',
            priority: 1,
            source: 'email',
            createdAt: ago(10),
            updatedAt: ago(10),
            group: null,
            toEmails: ['suporte@missaosalesiana.org.br'],
            requester: { email: 'req1@missaosalesiana.org.br', name: 'req1' },
            responder: null,
            html: '<p>A impressora parou.</p>',
            attachments: [],
            messages: [],
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (overrides: Partial<ImportOptions> = {}) =>
    importer.get(FreshdeskImportService).run({
      dir,
      apply: false,
      keep: new Set(),
      rules: {
        groups: new Map([
          ...DEFAULT_GROUP_RULES.groups,
          ['Suporte TI - Sede Inspetorial', 'Grupo 1'],
        ]),
        mailboxes: DEFAULT_GROUP_RULES.mailboxes,
      },
      ...overrides,
    });
  const imported = async () =>
    (await t.prisma.ticket.findMany({ select: { customFields: true } })).filter(
      (row) => row.customFields !== null,
    );

  it('simulação: relatório com grupos, duplicado e contatos novos, sem gravar nada', async () => {
    const before = await t.prisma.ticket.count();
    const report = await run();

    expect(report.applied).toBe(false);
    expect(report.tickets.map((plan) => [plan.freshdeskId, plan.group, plan.action])).toEqual([
      [101, 'Cadastros', 'import'],
      [102, 'Grupo 1', 'import'],
      [103, 'Grupo 1', 'skip-duplicate'],
    ]);
    expect(report.tickets[2]!.duplicateOf).toHaveLength(1);
    expect(report.tickets[0]).toMatchObject({ messages: 3, attachments: 2, inlineImages: 1 });
    expect(report.newContacts).toBe(1);
    expect(await t.prisma.ticket.count()).toBe(before);
    expect(await t.prisma.user.count({ where: { email: 'compras@fornecedor.com.br' } })).toBe(0);
  });

  it('grupo que não existe aqui: aponta no relatório e não grava nada, nem com --apply', async () => {
    const report = await run({
      apply: true,
      rules: {
        groups: new Map([['Suporte TI - Sede Inspetorial', 'Inexistente']]),
        mailboxes: new Map(),
      },
    });
    expect(report.applied).toBe(false);
    expect(report.missingGroups).toEqual(['Inexistente']);
    expect(await imported()).toHaveLength(0);
  });

  it('grava com autores, datas, notas, anexos e imagens; sem e-mail; SLA a partir de agora', async () => {
    const report = await run({ apply: true });
    expect(report.tickets.map((plan) => plan.action)).toEqual([
      'imported',
      'imported',
      'skip-duplicate',
    ]);
    expect(report.rejectedAttachments).toBe(1);

    const ticket = await t.prisma.ticket.findFirstOrThrow({
      where: { customFields: { path: ['freshdeskId'], equals: 101 } },
      include: {
        requester: true,
        messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
        events: true,
      },
    });
    expect(ticket).toMatchObject({
      status: 'open',
      priority: 'medium',
      source: 'email',
      groupId: cadastrosId,
      assigneeId: f.users.ag1,
      number: report.tickets[0]!.number,
    });
    expect(ticket.requester).toMatchObject({ isExternal: true, zitadelSub: null });
    expect(ticket.firstResponseAt?.toISOString()).toBe(ticket.messages[1]!.createdAt.toISOString());

    const [description, reply, note] = ticket.messages;
    expect(description!.bodyHtml).toContain('[imagem colada: inline-1.png, nos anexos]');
    expect(description!.bodyHtml).not.toContain('<script');
    expect(description!.bodyHtml).toContain('Anexos não importados do Freshdesk');
    expect(description!.attachments.map((a) => a.filename).toSorted()).toEqual([
      'inline-1.png',
      'orçamento.pdf',
    ]);
    expect(reply).toMatchObject({
      kind: 'public',
      authorId: f.users.ag1,
      bodyHtml: '<p>Recebido.</p>',
    });
    expect(reply!.quotedHtml).toContain('Segue o print');
    expect(note).toMatchObject({ kind: 'internal' });

    expect(ticket.events).toEqual([
      expect.objectContaining({
        actorId: systemId,
        type: 'imported',
        data: { source: 'freshdesk', freshdeskId: 101 },
      }),
    ]);
    expect(await t.prisma.notification.count()).toBe(0);

    // SLA: o tempo antes do import conta como pausa; o prazo da 1ª resposta fica ~8 h à frente.
    const due = ticket.firstResponseDueAt!.getTime() - Date.now();
    expect(Math.abs(due - 480 * MINUTE_MS)).toBeLessThan(5 * MINUTE_MS);
    expect(ticket.slaPausedMinutes).toBeGreaterThan(2 * 24 * 60 - 5);

    const pending = await t.prisma.ticket.findFirstOrThrow({
      where: { customFields: { path: ['freshdeskId'], equals: 102 } },
    });
    expect(pending).toMatchObject({ status: 'pending', priority: 'high', groupId: f.G1 });
    expect(pending.slaPausedAt).not.toBeNull();
  });

  it('rodar de novo não duplica; --keep importa o possível duplicado', async () => {
    await run({ apply: true });
    const again = await run({ apply: true, keep: new Set([103]) });
    expect(again.tickets.map((plan) => plan.action)).toEqual([
      'skip-existing',
      'skip-existing',
      'imported',
    ]);
    expect(await imported()).toHaveLength(3);
  });
});
