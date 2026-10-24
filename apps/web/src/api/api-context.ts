import { createContext, useContext } from 'react';
import type { ApiFetch } from './client.ts';

export const ApiContext = createContext<ApiFetch | null>(null);

/** Cliente da API com o access token do usuário logado. Exige o `<ApiProvider>`. */
export function useApi(): ApiFetch {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi() fora do <ApiProvider>');
  return api;
}
