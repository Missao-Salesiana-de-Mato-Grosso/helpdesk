import type {
  CreateHolidayInput,
  Holiday,
  SlaSettings,
  UpdateBusinessHoursInput,
  UpdateSlaPoliciesInput,
} from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';

const SETTINGS_KEY = ['admin', 'sla'] as const;
const HOLIDAYS_KEY = ['admin', 'holidays'] as const;

/** Toda mudança recalcula os prazos no servidor: as filas e os tickets abertos também mudam. */
function useInvalidate(key: readonly string[]) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };
}

/** T28: metas e horário comercial. */
export function useSlaSettings() {
  const api = useApi();
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<SlaSettings>('/admin/sla') });
}

export function useSavePolicies() {
  const api = useApi();
  const invalidate = useInvalidate(SETTINGS_KEY);
  return useMutation({
    mutationFn: (data: UpdateSlaPoliciesInput) =>
      api<SlaSettings>('/admin/sla/policies', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });
}

export function useSaveHours() {
  const api = useApi();
  const invalidate = useInvalidate(SETTINGS_KEY);
  return useMutation({
    mutationFn: (data: UpdateBusinessHoursInput) =>
      api<SlaSettings>('/admin/sla/hours', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });
}

export function useHolidays() {
  const api = useApi();
  return useQuery({ queryKey: HOLIDAYS_KEY, queryFn: () => api<Holiday[]>('/admin/holidays') });
}

export function useCreateHoliday() {
  const api = useApi();
  const invalidate = useInvalidate(HOLIDAYS_KEY);
  return useMutation({
    mutationFn: (data: CreateHolidayInput) =>
      api<Holiday>('/admin/holidays', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });
}

export function useDeleteHoliday() {
  const api = useApi();
  const invalidate = useInvalidate(HOLIDAYS_KEY);
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
