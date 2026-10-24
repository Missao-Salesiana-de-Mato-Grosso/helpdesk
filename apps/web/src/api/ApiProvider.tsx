import { useMemo, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiContext } from './api-context.ts';
import { createApiClient } from './client.ts';

/** Disponibiliza o cliente da API com o access token do usuário logado. */
export function ApiProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const token = auth.user?.access_token;
  const api = useMemo(() => createApiClient(() => token), [token]);
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}
