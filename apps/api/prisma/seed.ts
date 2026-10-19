// Dados de referência para desenvolvimento e homologação. Idempotente: pode rodar quantas vezes quiser.
// Em produção, os cadastros reais entram pelas telas de admin (Fase 2) ou por este mesmo script ajustado.
//
// Uso: `pnpm --filter @helpdesk/api prisma:seed` (ou `prisma db seed`).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/** E-mail do ator do sistema, usado como `actor_id` em eventos gerados por jobs e pelo canal de e-mail. */
export const SYSTEM_USER_EMAIL = 'system@helpdesk.local';

export const SEED = {
  departments: ['Secretaria', 'Financeiro', 'Pedagógico'],
  companies: ['Sede', 'Unidade de exemplo'],
  groups: [
    { name: 'Suporte TI', email: 'suporte@missaosalesiana.org.br' },
    { name: 'Sistemas', email: null },
  ],
  categories: [
    { name: 'Geral', group: 'Suporte TI' },
    { name: 'Acesso e senhas', group: 'Suporte TI' },
    { name: 'Sistema acadêmico', group: 'Sistemas' },
  ],
} as const;

export async function seed(prisma: PrismaClient): Promise<void> {
  for (const name of SEED.departments) {
    await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const name of SEED.companies) {
    await prisma.company.upsert({ where: { name }, update: {}, create: { name } });
  }

  const groupsByName = new Map<string, string>();
  for (const group of SEED.groups) {
    const row = await prisma.group.upsert({
      where: { name: group.name },
      update: { email: group.email },
      create: { name: group.name, email: group.email },
    });
    groupsByName.set(group.name, row.id);
  }

  for (const category of SEED.categories) {
    const defaultGroupId = groupsByName.get(category.group);
    if (!defaultGroupId) {
      throw new Error(
        `Seed: grupo "${category.group}" não encontrado para a categoria "${category.name}"`,
      );
    }
    await prisma.category.upsert({
      where: { name: category.name },
      update: { defaultGroupId },
      create: { name: category.name, defaultGroupId },
    });
  }

  // Ator do sistema: nunca autentica (active = false), só assina eventos automáticos.
  await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: { email: SYSTEM_USER_EMAIL, name: 'Sistema', active: false, isExternal: false },
  });
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') ?? false;
if (isDirectRun) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seed(prisma);
    process.stdout.write('Seed concluído.\n');
  } finally {
    await prisma.$disconnect();
  }
}
