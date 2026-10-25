import type { Role, TicketCounters, TicketView } from '@helpdesk/shared';

export interface NavItem {
  label: string;
  to: string;
  /** Contador de `GET /tickets/counters` mostrado ao lado do item. */
  counter?: keyof TicketCounters;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /** Ao menos uma destas roles. Ausente = todos os usuários logados. */
  roles?: Role[];
}

export const AGENT_ROLES: Role[] = ['agente', 'supervisor', 'admin'];

/** Rotas das filas do agente. O segmento vira o parâmetro `view` da API (T08). */
export const QUEUE_VIEWS = {
  meus: { label: 'Meus', view: 'mine', counter: 'mine' },
  grupo: { label: 'Do meu grupo', view: 'group', counter: 'group' },
  'sem-atribuicao': { label: 'Sem atribuição', view: 'unassigned', counter: 'unassigned' },
  todos: { label: 'Todos', view: 'all', counter: undefined },
} as const satisfies Record<
  string,
  { label: string; view: TicketView; counter: keyof TicketCounters | undefined }
>;

export type QueueSlug = keyof typeof QUEUE_VIEWS;

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Atendimento',
    roles: AGENT_ROLES,
    items: Object.entries(QUEUE_VIEWS).map(([slug, { label, counter }]) => ({
      label,
      to: `/fila/${slug}`,
      ...(counter ? { counter } : {}),
    })),
  },
  {
    title: 'Meus pedidos',
    items: [
      { label: 'Meus tickets', to: '/tickets' },
      { label: 'Novo ticket', to: '/tickets/novo' },
    ],
  },
  {
    title: 'Administração',
    roles: ['admin'],
    items: [
      { label: 'Usuários', to: '/admin/usuarios' },
      { label: 'Grupos', to: '/admin/grupos' },
    ],
  },
];

/** Seções visíveis para quem tem estas roles. Só UI: a autorização é da API. */
export function visibleSections(roles: readonly Role[]): NavSection[] {
  return NAV_SECTIONS.filter(
    (section) => !section.roles || section.roles.some((role) => roles.includes(role)),
  );
}

/** Página inicial: agentes vão para a própria fila; solicitantes, para os seus tickets. */
export function homePath(isAgent: boolean): string {
  return isAgent ? '/fila/meus' : '/tickets';
}
