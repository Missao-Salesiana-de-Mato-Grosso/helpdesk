#!/usr/bin/env node
// T29: separa do export do Freshdesk (scripts/freshdesk-export.mjs) só os chamados abertos e
// pendentes, num pacote pequeno para o import (apps/api/src/import). Sem dependências: Node 22+.
//
// Uso (Git Bash), ANTES de cancelar o Freshdesk:
//   node scripts/freshdesk-bundle.mjs [--export DIR] [--out DIR]
//
// Padrões: --export ~/freshdesk-export, --out ~/freshdesk-bundle.
// As imagens coladas no texto (attachment.freshdesk.com/inline/...) não vêm na lista de anexos do
// export: este script as baixa (o link tem token, vai sem autenticação) e troca o `src` por
// `fd-inline:<arquivo>`, que o import converte em anexo. Esses links morrem com o cancelamento.
// A saída tem dados pessoais (LGPD): guarde fora do repositório e apague depois do import.
// O log mostra só ids e contagens.

// Script de linha de comando: o console é a saída.
// oxlint-disable no-console
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    export: { type: 'string', default: path.join(homedir(), 'freshdesk-export') },
    out: { type: 'string', default: path.join(homedir(), 'freshdesk-bundle') },
  },
});

const OPEN_STATUSES = new Map([
  [2, 'open'],
  [3, 'pending'],
]);
const SOURCES = new Map([
  [1, 'email'],
  [2, 'portal'],
  [3, 'phone'],
]);
const INLINE =
  /(<img\b[^>]*?\bsrc\s*=\s*")(https:\/\/attachment\.freshdesk\.com\/inline\/[^"]+)(")/gi;
const EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );

// Mesmo nome que o export deu ao arquivo (scripts/freshdesk-export.mjs, safeName).
const safeName = (name) =>
  (name ?? '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(-120)
    .replace(/[. ]+$/, '') || 'arquivo';

const person = (entry) =>
  entry?.email ? { email: String(entry.email).toLowerCase(), name: entry.name ?? '' } : null;

const counts = {
  tickets: 0,
  messages: 0,
  attachments: 0,
  missingAttachments: 0,
  inline: 0,
  inlineFailed: 0,
};

async function main() {
  const root = args.export;
  const agents = new Map(
    (await readJson(path.join(root, 'agents.json'))).map((agent) => [
      agent.id,
      person(agent.contact),
    ]),
  );
  const contacts = new Map();
  for (const file of ['contacts.json', 'contacts_deleted.json']) {
    if (!(await exists(path.join(root, file)))) continue;
    for (const contact of await readJson(path.join(root, file)))
      contacts.set(contact.id, person(contact));
  }
  const groups = new Map(
    (await readJson(path.join(root, 'groups.json'))).map((group) => [group.id, group.name]),
  );
  const userById = (id) => agents.get(id) ?? contacts.get(id) ?? null;

  const filesDir = path.join(args.out, 'files');
  await mkdir(filesDir, { recursive: true });
  const tickets = [];

  for (const id of await readdir(path.join(root, 'tickets'))) {
    const dir = path.join(root, 'tickets', id);
    if (!(await exists(path.join(dir, 'ticket.json')))) continue;
    const ticket = await readJson(path.join(dir, 'ticket.json'));
    const status = OPEN_STATUSES.get(ticket.status);
    if (!status) continue;
    const conversations = (await exists(path.join(dir, 'conversations.json')))
      ? await readJson(path.join(dir, 'conversations.json'))
      : [];

    const ticketFiles = path.join(filesDir, String(ticket.id));
    await mkdir(ticketFiles, { recursive: true });
    let inlineIndex = 0;

    const copyAttachments = async (list) => {
      const out = [];
      for (const attachment of list ?? []) {
        const name = `${attachment.id}-${safeName(attachment.name)}`;
        const source = path.join(dir, 'attachments', name);
        if (!(await exists(source))) {
          counts.missingAttachments++;
          continue;
        }
        await copyFile(source, path.join(ticketFiles, name));
        out.push({ file: `${ticket.id}/${name}`, name: attachment.name ?? name });
        counts.attachments++;
      }
      return out;
    };

    // Baixa cada imagem colada e troca o src; se falhar, `fd-inline-missing:` (o import avisa no texto).
    const withInline = async (html) => {
      let result = html ?? '';
      // Percorre o original (`html`); `result` muda a cada troca.
      for (const match of (html ?? '').matchAll(INLINE)) {
        const url = match[2].replaceAll('&amp;', '&');
        let replacement = 'fd-inline-missing:';
        try {
          const res = await fetch(url);
          const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
          if (res.ok && EXTENSIONS.has(type)) {
            const name = `inline-${++inlineIndex}.${EXTENSIONS.get(type)}`;
            await writeFile(path.join(ticketFiles, name), Buffer.from(await res.arrayBuffer()));
            replacement = `fd-inline:${ticket.id}/${name}`;
            counts.inline++;
          } else {
            counts.inlineFailed++;
          }
        } catch {
          counts.inlineFailed++;
        }
        result = result.replace(match[0], `${match[1]}${replacement}${match[3]}`);
      }
      return result;
    };

    const messages = [];
    for (const conversation of conversations.toSorted((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )) {
      messages.push({
        createdAt: conversation.created_at,
        private: Boolean(conversation.private),
        author: userById(conversation.user_id) ?? person({ email: conversation.from_email }),
        html: await withInline(conversation.body),
        attachments: await copyAttachments(conversation.attachments),
      });
    }
    counts.messages += messages.length + 1;

    tickets.push({
      freshdeskId: ticket.id,
      subject: ticket.subject ?? '(sem assunto)',
      status,
      priority: ticket.priority,
      source: SOURCES.get(ticket.source) ?? 'email',
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      group: ticket.group_id ? (groups.get(ticket.group_id) ?? null) : null,
      toEmails: (ticket.to_emails ?? []).map((email) => String(email).toLowerCase()),
      requester: person(ticket.requester) ?? userById(ticket.requester_id),
      responder: ticket.responder_id ? userById(ticket.responder_id) : null,
      html: await withInline(ticket.description),
      attachments: await copyAttachments(ticket.attachments),
      messages,
    });
    counts.tickets++;
  }

  tickets.sort((a, b) => a.freshdeskId - b.freshdeskId);
  await writeFile(
    path.join(args.out, 'bundle.json'),
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tickets }, null, 1),
  );
  console.log(
    `Pacote em ${args.out}: ${counts.tickets} chamados, ${counts.messages} mensagens, ` +
      `${counts.attachments} anexos (${counts.missingAttachments} ausentes no export), ` +
      `${counts.inline} imagens coladas baixadas (${counts.inlineFailed} falharam).`,
  );
}

main().catch((error) => {
  console.error(`Falhou: ${error.message}`);
  process.exitCode = 1;
});
