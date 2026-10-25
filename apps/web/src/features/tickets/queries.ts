import type {
  CreateMessageInput,
  CreateTicketInput,
  NamedRef,
  TicketDetail,
  TicketListResponse,
  TicketStatus,
} from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';
import { ApiRequestError } from '../../api/client.ts';

export const ticketKeys = {
  all: ['tickets'] as const,
  list: (params: MyTicketsParams) => ['tickets', 'list', params] as const,
  detail: (id: string) => ['tickets', 'detail', id] as const,
};

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

export function useTicket(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ticketKeys.detail(id ?? ''),
    queryFn: () => api<TicketDetail>(`/tickets/${id ?? ''}`),
    enabled: Boolean(id),
    retry: retryUnlessClientError,
  });
}

export function useCreateTicket() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTicketInput) =>
      api<TicketDetail>('/tickets', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: [...ticketKeys.all, 'list'] });
    },
  });
}

export function useReply(ticketId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMessageInput) =>
      api<TicketDetail>(`/tickets/${ticketId}/messages`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: [...ticketKeys.all, 'list'] });
    },
  });
}
