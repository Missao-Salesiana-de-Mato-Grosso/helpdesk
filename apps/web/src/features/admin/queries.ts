import type {
  AccessRequestListResponse,
  ApproveAccessInput,
  EmptyTrashResponse,
  MeResponse,
  NamedRef,
  RejectAccessInput,
  UpdateUserInput,
  UserListResponse,
  UserSummary,
} from '@helpdesk/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useDepartments() {
  const api = useApi();
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => api<NamedRef[]>('/departments'),
    staleTime: 5 * 60_000,
  });
}

// ───────────── T15: usuários e membros de grupo ─────────────

export interface UsersParams {
  q?: string;
  role?: 'agent';
  page?: number;
  pageSize?: number;
}

export function useUsers(params: UsersParams) {
  const api = useApi();
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.role) search.set('role', params.role);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const query = search.toString();
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => api<UserListResponse>(`/users${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateUser() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) =>
      api<UserSummary>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useReplaceGroupMembers(groupId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<NamedRef[]>(`/groups/${groupId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ userIds }),
      }),
    onSuccess: (members) => {
      queryClient.setQueryData(['groups', groupId, 'members'], members);
      // A coluna "Grupos" da lista de usuários mudou.
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
