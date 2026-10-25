import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  OUTCOME_LABELS,
  type MailboxSession,
  type MailboxSource,
  type RawEmail,
} from './mailbox-source.js';

/** Pasta dos e-mails anteriores a `MAILBOX_START_SINCE` (RN-02), que nunca viram ticket. */
const IGNORED = 'ignorado';

/** `Date:` do cabeçalho do .eml (sem parser completo: só o bloco de cabeçalhos). */
export function headerDate(raw: Buffer): Date | null {
  const text = raw.subarray(0, 64 * 1024).toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  const headers = (end === -1 ? text : text.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ');
  const match = /^date:[ \t]*(.+)$/im.exec(headers);
  if (!match) return null;
  const date = new Date(match[1]!.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Driver `folder` (dev e testes): cada `*.eml` da pasta, em ordem de nome. Depois de processado, o
 * arquivo vai para `processado/`, `descartado/` ou `erro/`, o equivalente aos rótulos do Gmail. O
 * progresso é a própria pasta: o que ficou na raiz ainda não foi processado.
 */
export class FolderMailboxSource implements MailboxSource {
  constructor(
    private readonly root: string,
    private readonly startSince: Date | null,
  ) {}

  open(): Promise<MailboxSession> {
    const names = new Map<number, string>();
    const move = async (name: string, folder: string) => {
      await mkdir(join(this.root, folder), { recursive: true });
      await rename(join(this.root, name), join(this.root, folder, name));
    };

    return Promise.resolve({
      next: async (limit: number) => {
        const files = await this.pending();
        const emails: RawEmail[] = [];
        for (const name of files) {
          if (emails.length >= limit) break;
          const raw = await readFile(join(this.root, name));
          const internalDate = headerDate(raw) ?? (await stat(join(this.root, name))).mtime;
          if (this.startSince && internalDate < this.startSince) {
            await move(name, IGNORED);
            continue;
          }
          const uid = names.size + 1;
          names.set(uid, name);
          emails.push({ uid, raw, internalDate });
        }
        return emails;
      },
      done: async (email, outcome) => {
        const name = names.get(email.uid);
        if (name) await move(name, OUTCOME_LABELS[outcome]);
      },
      close: () => Promise.resolve(),
    });
  }

  private async pending(): Promise<string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.eml'))
        .map((entry) => entry.name)
        .toSorted((a, b) => a.localeCompare(b));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }
}
