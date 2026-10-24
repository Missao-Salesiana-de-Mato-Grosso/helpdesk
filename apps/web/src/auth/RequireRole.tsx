import type { Role } from '@helpdesk/shared';
import type { ReactNode } from 'react';
import { StatusScreen } from './StatusScreen.tsx';
import { useMe } from './useMe.ts';

/**
 * Exige ao menos uma das roles. Use dentro do `RequireAuth`. É só conveniência de UI:
 * a autorização de verdade é a da API.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  if (!roles.some((role) => me.roles.includes(role))) {
    return (
      <StatusScreen title="Sem permissão">
        <p>Você não tem permissão para acessar esta página.</p>
      </StatusScreen>
    );
  }
  return <>{children}</>;
}
