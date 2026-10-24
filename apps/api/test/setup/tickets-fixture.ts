// Fixture da spec T08–T10 §9: unidades U1/U2, grupos G1/G2, categorias C1 (G1) e C2 (G2) e os usuários
// req1, req2 (solicitantes), ext1 (terceiro sem unidade), ag1 (G1), ag2 (G2), sup e adm.
import type { Role } from '@helpdesk/shared';
import type { TicketPriority, TicketStatus } from '../../src/generated/prisma/client.js';
import type { TestApp } from './auth.js';

export type FixtureUser = 'req1' | 'req2' | 'ext1' | 'ag1' | 'ag2' | 'sup' | 'adm';

export interface TicketsFixture {
  U1: string;
  U2: string;
  G1: string;
  G2: string;
  C1: string;
  C2: string;
  D1: string;
  users: Record<FixtureUser, string>;
  /** Access token de cada usuário (ext1 nunca faz login: não tem token). */
  token(user: Exclude<FixtureUser, 'ext1'>): Promise<string>;
  /** Cria um ticket direto no banco (com 1 mensagem pública), para montar cenários de leitura. */
  ticket(options: TicketOptions): Promise<{ id: string; number: number }>;
}

export interface TicketOptions {
  requester: FixtureUser;
  group?: 'G1' | 'G2';
  company?: 'U1' | 'U2' | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee?: FixtureUser | null;
  subject?: string;
}

const ROLES: Record<FixtureUser, Role[]> = {
  req1: [],
  req2: [],
  ext1: [],
  ag1: ['agente'],
  ag2: ['agente'],
  sup: ['supervisor'],
  adm: ['admin'],
};

export async function createTicketsFixture(t: TestApp): Promise<TicketsFixture> {
  const { prisma } = t;
  const [U1, U2] = await Promise.all(
    ['Unidade 1', 'Unidade 2'].map((name) => prisma.company.create({ data: { name } })),
  );
  const D1 = await prisma.department.create({ data: { name: 'Secretaria' } });
  const [G1, G2] = await Promise.all(
    ['Grupo 1', 'Grupo 2'].map((name) => prisma.group.create({ data: { name } })),
  );
  const C1 = await prisma.category.create({
    data: { name: 'Categoria 1', defaultGroupId: G1!.id },
  });
  const C2 = await prisma.category.create({
    data: { name: 'Categoria 2', defaultGroupId: G2!.id },
  });

  const companyOf: Record<FixtureUser, string | null> = {
    req1: U1!.id,
    req2: U2!.id,
    ext1: null,
    ag1: U1!.id,
    ag2: U2!.id,
    sup: U1!.id,
    adm: U1!.id,
  };

  const createUser = async (key: FixtureUser): Promise<string> => {
    const external = key === 'ext1';
    const user = await prisma.user.create({
      data: {
        email: `${key}@missaosalesiana.org.br`,
        name: key,
        roles: ROLES[key],
        isExternal: external,
        zitadelSub: external ? null : `sub-${key}`,
        companyId: companyOf[key],
        departmentId: external ? null : D1.id,
        lastLoginAt: new Date(),
        profileSyncedAt: new Date(),
      },
    });
    return user.id;
  };
  const users: Record<FixtureUser, string> = {
    req1: await createUser('req1'),
    req2: await createUser('req2'),
    ext1: await createUser('ext1'),
    ag1: await createUser('ag1'),
    ag2: await createUser('ag2'),
    sup: await createUser('sup'),
    adm: await createUser('adm'),
  };
  await prisma.groupMember.createMany({
    data: [
      { groupId: G1!.id, userId: users.ag1 },
      { groupId: G2!.id, userId: users.ag2 },
    ],
  });

  const ids = { U1: U1!.id, U2: U2!.id, G1: G1!.id, G2: G2!.id, C1: C1.id, C2: C2.id };

  return {
    ...ids,
    D1: D1.id,
    users,
    token: (user) => t.tokens.sign({ sub: `sub-${user}`, roles: ROLES[user] }),
    async ticket(options) {
      const group = options.group ?? 'G1';
      const companyId =
        options.company === undefined
          ? companyOf[options.requester]
          : options.company === null
            ? null
            : ids[options.company];
      const ticket = await prisma.ticket.create({
        data: {
          subject: options.subject ?? 'Ticket de teste',
          status: options.status ?? 'open',
          priority: options.priority ?? 'medium',
          source: 'portal',
          requesterId: users[options.requester],
          assigneeId: options.assignee ? users[options.assignee] : null,
          groupId: ids[group],
          categoryId: group === 'G1' ? ids.C1 : ids.C2,
          companyId,
          messages: {
            create: {
              authorId: users[options.requester],
              kind: 'public',
              via: 'portal',
              bodyHtml: '<p>Corpo</p>',
            },
          },
          events: { create: { actorId: users[options.requester], type: 'created' } },
        },
        select: { id: true, number: true },
      });
      return ticket;
    },
  };
}
