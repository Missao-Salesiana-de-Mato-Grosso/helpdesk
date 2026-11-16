import type { SignatureResponse, UpdateSignatureInput } from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';

const KEY = ['me', 'signature'] as const;

/** T31: a assinatura de e-mail do próprio agente. */
export function useSignature() {
  const api = useApi();
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<SignatureResponse>('/me/signature'),
  });
}

/** Grava e devolve a assinatura como ficou depois de sanitizada; vazio apaga. */
export function useSaveSignature() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSignatureInput) =>
      api<SignatureResponse>('/me/signature', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });
}
