import type {
  CannedResponse,
  CreateCannedResponseInput,
  UpdateCannedResponseInput,
} from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';

const KEY = ['canned-responses'] as const;

/** T26: respostas prontas (todas; a lista é curta). */
export function useCannedResponses() {
  const api = useApi();
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<CannedResponse[]>('/canned-responses'),
    staleTime: 60_000,
  });
}

/** Sem `id` cria; com `id` edita só os campos enviados. */
export function useSaveCannedResponse() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { id?: undefined; data: CreateCannedResponseInput }
        | { id: string; data: UpdateCannedResponseInput },
    ) =>
      api<CannedResponse>(input.id ? `/canned-responses/${input.id}` : '/canned-responses', {
        method: input.id ? 'PATCH' : 'POST',
        body: JSON.stringify(input.data),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCannedResponse() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/canned-responses/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
