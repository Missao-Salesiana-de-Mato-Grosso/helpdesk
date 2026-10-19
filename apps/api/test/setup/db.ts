import type { PrismaClient } from '../../src/generated/prisma/client.js';

// A ordem não importa: TRUNCATE ... CASCADE limpa as dependentes. RESTART IDENTITY volta cada sequência
// ao seu START; a migração inicial define START 1001 em tickets.number, então os testes recomeçam em #1001.
const TABLES = [
  'app_settings',
  'email_message_refs',
  'inbound_emails',
  'notifications',
  'ticket_events',
  'attachments',
  'ticket_messages',
  'tickets',
  'categories',
  'group_members',
  'groups',
  'users',
  'departments',
  'companies',
];

/** Esvazia todas as tabelas da aplicação. Chamar em `beforeEach` dos testes e2e. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
