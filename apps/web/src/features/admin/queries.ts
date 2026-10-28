import type {
  AccessRequestListResponse,
  ApproveAccessInput,
  EmptyTrashResponse,
  MeResponse,
  RejectAccessInput,
} from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';

export type AccessRequestsStatus = 'pending' | 'trashed';

const accessRequestsKey = (status: AccessRequestsStatus) => ['access-requests', status] as const;

export function useAccessRequests(status: AccessRequestsStatus) {
  const api = useApi();
  return useQuery({
    queryKey: accessRequestsKey(status),
    queryFn: () => api<AccessRequestListResponse>(`/users/access-requests?status=${status}`),
    refetchInterval: 30_000,
  });
}

/** Qualquer decisão sobre um pedido invalida as duas abas (pending e trashed) da fila. */
function useInvalidateAccessRequests() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['access-requests'] });
}

export function useApproveAccess() {
  const api = useApi();
  const invalidate = useInvalidateAccessRequests();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ApproveAccessInput }) =>
      api<MeResponse>(`/users/${id}/access/approve`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: invalidate,
  });
}

export function useRejectAccess() {
  const api = useApi();
  const invalidate = useInvalidateAccessRequests();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RejectAccessInput }) =>
      api<MeResponse>(`/users/${id}/access/reject`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: invalidate,
  });
}

export function useRestoreAccess() {
  const api = useApi();
  const invalidate = useInvalidateAccessRequests();
  return useMutation({
    mutationFn: (id: string) => api<MeResponse>(`/users/${id}/access/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useTrashAccess() {
  const api = useApi();
  const invalidate = useInvalidateAccessRequests();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/users/${id}/access/trash`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useEmptyTrash() {
  const api = useApi();
  const invalidate = useInvalidateAccessRequests();
  return useMutation({
    mutationFn: () => api<EmptyTrashResponse>('/users/access-requests/trash', { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
