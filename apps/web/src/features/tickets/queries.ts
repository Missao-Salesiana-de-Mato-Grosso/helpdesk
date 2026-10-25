import type {
  CreateMessageInput,
  CreateTicketInput,
  NamedRef,
  TicketCounters,
  TicketDetail,
  TicketListResponse,
  TicketPriority,
  TicketSort,
  TicketStatus,
  TicketView,
  UpdateTicketInput,
} from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';
import { ApiRequestError } from '../../api/client.ts';
import { requestBody } from '../attachments/attachments.ts';

export const ticketKeys = {
  all: ['tickets'] as const,
  list: (params: MyTicketsParams | QueueParams) => ['tickets', 'list', params] as const,
  detail: (id: string) => ['tickets', 'detail', id] as const,
  counters: ['tickets', 'counters'] as const,
};

/** Polling das filas, contadores e detalhe do agente (03-arquitetura: tempo real = polling de 30 s). */
export const POLL_INTERVAL_MS = 30_000;

export interface QueueParams {
  view: TicketView;
  statuses: readonly TicketStatus[];
  priorities: readonly TicketPriority[];
  companyId: string | null;
  noCompany: boolean;
  groupId: string | null;
  q: string;
  sort: TicketSort;
  page: number;
}

export const QUEUE_PAGE_SIZE = 25;

export interface MyTicketsParams {
  statuses: readonly TicketStatus[];
  q: string;
  page: number;
}

export const MY_TICKETS_PAGE_SIZE = 25;

/** 4xx não melhora com retry (404 de ticket fora do escopo, por exemplo). */
const retryUnlessClientError = (failureCount: number, error: Error) =>
  !(error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500) &&
  failureCount < 2;

export function useCategories() {
  const api = useApi();
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api<NamedRef[]>('/categories'),
    staleTime: 5 * 60_000,
  });
}

export function useCompanies() {
  const api = useApi();
  return useQuery({
    queryKey: ['companies'],
    queryFn: () => api<NamedRef[]>('/companies'),
    staleTime: 5 * 60_000,
  });
}

export function useMyTickets(params: MyTicketsParams) {
  const api = useApi();
  return useQuery({
    queryKey: ticketKeys.list(params),
    queryFn: () => {
      const search = new URLSearchParams({
        view: 'requested',
        page: String(params.page),
        pageSize: String(MY_TICKETS_PAGE_SIZE),
      });
      for (const status of params.statuses) search.append('status', status);
      if (params.q) search.set('q', params.q);
      return api<TicketListResponse>(`/tickets?${search.toString()}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function useTicket(id: string | undefined, { poll = false } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: ticketKeys.detail(id ?? ''),
    queryFn: () => api<TicketDetail>(`/tickets/${id ?? ''}`),
    enabled: Boolean(id),
    retry: retryUnlessClientError,
    refetchInterval: poll ? POLL_INTERVAL_MS : false,
  });
}

export function useQueue(params: QueueParams) {
  const api = useApi();
  return useQuery({
    queryKey: ticketKeys.list(params),
    queryFn: () => {
      const search = new URLSearchParams({
        view: params.view,
        page: String(params.page),
        pageSize: String(QUEUE_PAGE_SIZE),
        sort: params.sort,
      });
      for (const status of params.statuses) search.append('status', status);
      for (const priority of params.priorities) search.append('priority', priority);
      if (params.noCompany) search.set('noCompany', 'true');
      else if (params.companyId) search.set('companyId', params.companyId);
      if (params.groupId) search.set('groupId', params.groupId);
      if (params.q) search.set('q', params.q);
      return api<TicketListResponse>(`/tickets?${search.toString()}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useTicketCounters(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ticketKeys.counters,
    queryFn: () => api<TicketCounters>('/tickets/counters'),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useGroups() {
  const api = useApi();
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api<NamedRef[]>('/groups'),
    staleTime: 5 * 60_000,
  });
}

export function useGroupMembers(groupId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['groups', groupId, 'members'],
    queryFn: () => api<NamedRef[]>(`/groups/${groupId}/members`),
    staleTime: 60_000,
  });
}

export const isVersionConflict = (error: unknown) =>
  error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT';

/** Atualiza o cache com o ticket devolvido; no 409 recarrega a versão atual (o chamador avisa). */
function useTicketWriteCallbacks() {
  const queryClient = useQueryClient();
  return {
    onSuccess: (ticket: TicketDetail) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: [...ticketKeys.all, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.counters });
    },
    reloadOnConflict: (ticketId: string, error: unknown) => {
      if (isVersionConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
      }
    },
  };
}

export function useUpdateTicket(ticketId: string) {
  const api = useApi();
  const callbacks = useTicketWriteCallbacks();
  return useMutation({
    mutationFn: (body: UpdateTicketInput) =>
      api<TicketDetail>(`/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: callbacks.onSuccess,
    onError: (error) => callbacks.reloadOnConflict(ticketId, error),
  });
}

export function useCreateTicket() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ data, files = [] }: { data: CreateTicketInput; files?: readonly File[] }) =>
      api<TicketDetail>('/tickets', { method: 'POST', body: requestBody(data, files) }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: [...ticketKeys.all, 'list'] });
    },
  });
}

export function useReply(ticketId: string) {
  const api = useApi();
  const callbacks = useTicketWriteCallbacks();
  return useMutation({
    mutationFn: ({ data, files = [] }: { data: CreateMessageInput; files?: readonly File[] }) =>
      api<TicketDetail>(`/tickets/${ticketId}/messages`, {
        method: 'POST',
        body: requestBody(data, files),
      }),
    onSuccess: callbacks.onSuccess,
    onError: (error) => callbacks.reloadOnConflict(ticketId, error),
  });
}
