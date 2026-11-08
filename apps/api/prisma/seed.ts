// Dados de referência iniciais. Idempotente: o Job de migração roda a cada deploy.
// T25: cada cadastro só é populado com a tabela vazia, porque depois disso ele é mantido pelas telas
// de admin (um item renomeado lá não pode voltar com o nome antigo no próximo deploy). A exceção é a
// categoria "Geral", que o canal de e-mail exige (T21) e por isso é sempre garantida.
//
// Uso: `pnpm --filter @helpdesk/api prisma:seed` (ou `prisma db seed`).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { SYSTEM_USER_EMAIL } from '../src/users/system-user.js';

export { SYSTEM_USER_EMAIL };

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

/** Mesmo valor de `DEFAULT_CATEGORY_NAME` (@helpdesk/shared); o teste do seed confere. */
export const DEFAULT_CATEGORY = 'Geral';

export async function seed(prisma: PrismaClient): Promise<void> {
  if ((await prisma.department.count()) === 0) {
    await prisma.department.createMany({ data: SEED.departments.map((name) => ({ name })) });
  }

  if ((await prisma.company.count()) === 0) {
    await prisma.company.createMany({ data: SEED.companies.map((name) => ({ name })) });
  }

  if ((await prisma.group.count()) === 0) {
    await prisma.group.createMany({ data: SEED.groups.map((group) => ({ ...group })) });
  }

  if ((await prisma.category.count()) === 0) {
    const groups = await prisma.group.findMany({ select: { id: true, name: true } });
    const groupsByName = new Map(groups.map((group) => [group.name, group.id]));
    for (const category of SEED.categories) {
      const defaultGroupId = groupsByName.get(category.group);
      if (!defaultGroupId) {
        throw new Error(
          `Seed: grupo "${category.group}" não encontrado para a categoria "${category.name}"`,
        );
      }
      await prisma.category.create({ data: { name: category.name, defaultGroupId } });
    }
  }

  const geral = await prisma.category.findUnique({ where: { name: DEFAULT_CATEGORY } });
  if (!geral) {
    // Sem a "Geral", o e-mail de entrada falha: recria no grupo mais antigo que estiver ativo.
    const group = await prisma.group.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!group) throw new Error('Seed: nenhum grupo ativo para a categoria "Geral"');
    await prisma.category.create({ data: { name: DEFAULT_CATEGORY, defaultGroupId: group.id } });
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
