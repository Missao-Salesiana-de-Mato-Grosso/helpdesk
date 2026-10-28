import type { MeResponse } from '@helpdesk/shared';
import { useQuery, type UndefinedInitialDataOptions } from '@tanstack/react-query';
import { useApi } from '../api/api-context.ts';
import { ApiRequestError } from '../api/client.ts';

export const ME_QUERY_KEY = ['me'] as const;

type MeQueryOverrides = Partial<
  Pick<UndefinedInitialDataOptions<MeResponse, ApiRequestError>, 'refetchInterval'>
>;

/** `GET /api/me`. Erros de autorização não são repetidos: o RequireAuth trata cada código. */
export function useMe(enabled = true, overrides: MeQueryOverrides = {}) {
  const api = useApi();
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api<MeResponse>('/me'),
    enabled,
    staleTime: 60_000,
    retry: (failureCount, error) =>
      !(error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500) &&
      failureCount < 2,
    ...overrides,
  });
}
