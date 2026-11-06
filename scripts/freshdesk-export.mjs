#!/usr/bin/env node
// Exporta o Freshdesk antes do cancelamento (05-plano-mvp §5.4, passo 8; risco R6).
// Sem dependências: Node 22+ (fetch nativo).
//
// Uso (Git Bash):
//   export FRESHDESK_DOMAIN=empresa          # subdomínio de empresa.freshdesk.com
//   read -rs FRESHDESK_API_KEY && export FRESHDESK_API_KEY
//                                            # cole a chave e tecle Enter: não aparece nem vai para o histórico
//   node scripts/freshdesk-export.mjs [--out DIR] [--no-attachments]
//
// A chave fica no Freshdesk em Perfil → "Sua chave de API".
// Saída padrão: ~/freshdesk-export. Pode ser interrompido e rodado de novo: tickets já
// completos (e não alterados desde então) são pulados, e só refaz o que falhou.
// A saída tem dados pessoais (LGPD): guarde fora do repositório, com acesso restrito.
// O log mostra só ids e contagens, nunca conteúdo de mensagem nem a chave.

// Script de linha de comando: o console é a saída.
// oxlint-disable no-console
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(homedir(), 'freshdesk-export') },
    'no-attachments': { type: 'boolean', default: false },
  },
});

const domain = process.env.FRESHDESK_DOMAIN?.trim()
  .replace(/^https?:\/\//, '')
  .replace(/\.freshdesk\.com\/?$/, '');
const apiKey = process.env.FRESHDESK_API_KEY?.trim();
if (!domain || !apiKey) {
  console.error('Defina FRESHDESK_DOMAIN e FRESHDESK_API_KEY (veja o cabeçalho do script).');
  process.exit(1);
}

const BASE = `https://${domain}.freshdesk.com/api/v2`;
const AUTH = `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;
const OUT = path.resolve(args.out);
const EPOCH = '2000-01-01T00:00:00Z';
// A listagem de tickets não passa da página 300; acima disso a busca recomeça por updated_since.
const MAX_PAGE = 300;
const errors = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpError extends Error {
  constructor(status, where) {
    super(`HTTP ${status} em ${where}`);
    this.status = status;
  }
}

// Repete em 429 (respeitando Retry-After), em 5xx e em falha de rede.
async function request(url, { auth = true } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: auth ? { Authorization: AUTH } : {} });
    } catch (err) {
      if (attempt >= 5) throw err;
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 60;
      console.log(`  limite da API atingido, aguardando ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 5) {
      await sleep(2000 * attempt);
      continue;
    }
    return res;
  }
}

const nextLink = (header) => header?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;

async function getJson(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : BASE + pathOrUrl;
  const res = await request(url);
  if (!res.ok) throw new HttpError(res.status, new URL(url).pathname);
  return { body: await res.json(), next: nextLink(res.headers.get('link')) };
}

async function listAll(first) {
  const items = [];
  for (let url = first; url;) {
    const { body, next } = await getJson(url);
    items.push(...body);
    url = next;
  }
  return items;
}

async function listTickets(filter) {
  const byId = new Map();
  let since = EPOCH;
  for (;;) {
    let page = 1;
    let last = null;
    for (; page <= MAX_PAGE; page++) {
      const query = filter
        ? `filter=${filter}`
        : `updated_since=${encodeURIComponent(since)}&order_by=updated_at&order_type=asc`;
      const { body } = await getJson(`/tickets?${query}&per_page=100&page=${page}`);
      for (const ticket of body) byId.set(ticket.id, ticket);
      if (body.length > 0) last = body.at(-1);
      if (body.length < 100) break;
    }
    if (page <= MAX_PAGE || !last || last.updated_at === since) break;
    if (filter) {
      console.log(`  aviso: a lista "${filter}" passou de ${MAX_PAGE} páginas e foi truncada`);
      break;
    }
    since = last.updated_at;
  }
  return [...byId.values()];
}

const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2));

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

// Mantém a extensão e tira caracteres que o Windows não aceita.
const safeName = (name) =>
  (name ?? '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(-120)
    .replace(/[. ]+$/, '') || 'arquivo';

// O attachment_url é um link assinado do S3, com validade curta: vai sem o header de auth
// e é baixado logo depois de lido. Se expirar, a próxima rodada relê o ticket.
async function downloadAttachment(dir, ticketId, attachment) {
  const file = path.join(dir, 'attachments', `${attachment.id}-${safeName(attachment.name)}`);
  if (await exists(file)) return true;
  const res = await request(attachment.attachment_url, { auth: false });
  if (!res.ok) {
    errors.push({ ticket: ticketId, attachment: attachment.id, status: res.status });
    return false;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  await rename(`${file}.part`, file);
  return true;
}

async function exportTicket(summary) {
  const dir = path.join(OUT, 'tickets', String(summary.id));
  const doneFile = path.join(dir, '.done');
  if ((await readText(doneFile)) === summary.updated_at) return 'skipped';
  await mkdir(dir, { recursive: true });

  const { body: ticket } = await getJson(`/tickets/${summary.id}?include=requester,company,stats`);
  const conversations = await listAll(`/tickets/${summary.id}/conversations?per_page=100`);
  await writeJson(path.join(dir, 'ticket.json'), ticket);
  await writeJson(path.join(dir, 'conversations.json'), conversations);

  let complete = true;
  if (!args['no-attachments']) {
    const attachments = [
      ...(ticket.attachments ?? []),
      ...conversations.flatMap((conversation) => conversation.attachments ?? []),
    ];
    for (const attachment of attachments) {
      complete = (await downloadAttachment(dir, summary.id, attachment)) && complete;
    }
  }
  if (!complete) return 'partial';
  await writeFile(doneFile, summary.updated_at);
  return 'exported';
}

async function main() {
  await mkdir(path.join(OUT, 'tickets'), { recursive: true });
  console.log(`Saída: ${OUT}`);
  const startedAt = new Date().toISOString();

  try {
    await getJson('/agents/me');
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      console.error('Chave recusada (401). Confira FRESHDESK_API_KEY e FRESHDESK_DOMAIN.');
      process.exit(1);
    }
    throw err;
  }

  const counts = {};
  const lists = [
    ['agents', '/agents?per_page=100'],
    ['groups', '/groups?per_page=100'],
    ['companies', '/companies?per_page=100'],
    ['contacts', '/contacts?per_page=100'],
    ['contacts_deleted', '/contacts?state=deleted&per_page=100'],
    ['ticket_fields', '/ticket_fields'],
    ['satisfaction_ratings', `/surveys/satisfaction_ratings?per_page=100&created_since=${EPOCH}`],
  ];
  for (const [name, url] of lists) {
    try {
      const items = await listAll(url);
      await writeJson(path.join(OUT, `${name}.json`), items);
      counts[name] = items.length;
      console.log(`${name}: ${items.length}`);
    } catch (err) {
      // Algumas listas dependem do plano ou de permissão de admin; o resto segue.
      errors.push({ list: name, error: err.message });
      console.log(`${name}: falhou (${err.message})`);
    }
  }

  const summaries = new Map();
  for (const filter of [null, 'deleted', 'spam']) {
    const label = filter ?? 'tickets';
    try {
      const tickets = await listTickets(filter);
      for (const ticket of tickets) summaries.set(ticket.id, { ...ticket, export_list: label });
      counts[`list_${label}`] = tickets.length;
      console.log(`lista ${label}: ${tickets.length}`);
    } catch (err) {
      errors.push({ list: label, error: err.message });
      console.log(`lista ${label}: falhou (${err.message})`);
    }
  }
  const tickets = [...summaries.values()].toSorted((a, b) => a.id - b.id);
  await writeJson(path.join(OUT, 'tickets', 'index.json'), tickets);

  const results = { exported: 0, skipped: 0, partial: 0, failed: 0 };
  for (const [index, summary] of tickets.entries()) {
    try {
      results[await exportTicket(summary)]++;
    } catch (err) {
      results.failed++;
      errors.push({ ticket: summary.id, error: err.message });
    }
    if ((index + 1) % 25 === 0 || index + 1 === tickets.length) {
      console.log(`tickets: ${index + 1}/${tickets.length}`);
    }
  }

  await writeJson(path.join(OUT, 'manifest.json'), {
    domain,
    startedAt,
    finishedAt: new Date().toISOString(),
    attachments: !args['no-attachments'],
    counts,
    results,
    errors,
  });
  console.log(
    `Fim. exportados ${results.exported}, já completos ${results.skipped}, ` +
      `incompletos ${results.partial}, com erro ${results.failed}. Detalhes em manifest.json`,
  );
  if (errors.length > 0) {
    console.log(`${errors.length} erro(s): rode de novo para tentar só o que faltou.`);
    process.exitCode = 1;
  }
}

await main();
