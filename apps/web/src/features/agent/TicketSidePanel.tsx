import { Badge, Button, Checkbox, Group, Paper, Select, Stack, Text } from '@mantine/core';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type MeResponse,
  type NamedRef,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
  type UpdateTicketInput,
} from '@helpdesk/shared';
import { useState, type Ref } from 'react';
import { PRIORITY_LABEL, STATUS_LABEL } from '../tickets/format.ts';
import { useCategories, useCompanies, useGroupMembers, useGroups } from '../tickets/queries.ts';

export type TicketChanges = Omit<UpdateTicketInput, 'version'>;

/** Transições que o backend aceita (RN-23 da spec T08–T10); só para montar as opções. */
const NEXT_STATUSES: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: [],
};

const NO_ASSIGNEE = '__nobody__';

const isStatus = (value: string | null): value is TicketStatus =>
  value !== null && (TICKET_STATUSES as readonly string[]).includes(value);
const isPriority = (value: string | null): value is TicketPriority =>
  value !== null && (TICKET_PRIORITIES as readonly string[]).includes(value);

/** Opções da lista, garantindo que o valor atual apareça mesmo se inativo ou fora da lista. */
function options(items: NamedRef[] | undefined, current: NamedRef | null) {
  const list = items ?? [];
  const all = current && !list.some((item) => item.id === current.id) ? [current, ...list] : list;
  return all.map((item) => ({ value: item.id, label: item.name }));
}

export interface TicketSidePanelProps {
  ticket: TicketDetail;
  me: MeResponse;
  onChange: (changes: TicketChanges) => void;
  /** Resolver ou fechar sem unidade: mostra o erro no campo Unidade e o foca. */
  onCompanyRequired: () => void;
  companyRef: Ref<HTMLInputElement>;
  companyError: string | undefined;
  saving: boolean;
}

/** Painel lateral do agente (T12): cada mudança vira um PATCH com a `version` atual. */
export function TicketSidePanel({
  ticket,
  me,
  onChange,
  onCompanyRequired,
  companyRef,
  companyError,
  saving,
}: TicketSidePanelProps) {
  const groups = useGroups();
  const members = useGroupMembers(ticket.group.id);
  const categories = useCategories();
  const companies = useCompanies();
  const [applyToRequester, setApplyToRequester] = useState(true);
  const closed = ticket.status === 'closed';
  const disabled = closed || saving;
  const requesterWithoutCompany = ticket.requester.company === null;

  const changeStatus = (value: string | null) => {
    if (!isStatus(value) || value === ticket.status) return;
    if ((value === 'resolved' || value === 'closed') && ticket.company === null) {
      onCompanyRequired();
      return;
    }
    onChange({ status: value });
  };

  return (
    <Stack>
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Select
            label="Situação"
            data={[ticket.status, ...NEXT_STATUSES[ticket.status]].map((value) => ({
              value,
              label: STATUS_LABEL[value],
            }))}
            value={ticket.status}
            onChange={changeStatus}
            allowDeselect={false}
            disabled={disabled}
          />
          <Select
            label="Prioridade"
            data={TICKET_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }))}
            value={ticket.priority}
            onChange={(value) => {
              if (isPriority(value) && value !== ticket.priority) onChange({ priority: value });
            }}
            allowDeselect={false}
            disabled={disabled}
          />
          <Select
            label="Grupo"
            data={options(groups.data, ticket.group)}
            value={ticket.group.id}
            onChange={(value) => {
              if (value && value !== ticket.group.id) onChange({ groupId: value });
            }}
            allowDeselect={false}
            disabled={disabled}
          />
          <div>
            <Select
              label="Responsável"
              data={[
                { value: NO_ASSIGNEE, label: 'Ninguém' },
                ...options(members.data, ticket.assignee),
              ]}
              value={ticket.assignee?.id ?? NO_ASSIGNEE}
              onChange={(value) => {
                const assigneeId = !value || value === NO_ASSIGNEE ? null : value;
                if (assigneeId !== (ticket.assignee?.id ?? null)) onChange({ assigneeId });
              }}
              allowDeselect={false}
              disabled={disabled}
            />
            {ticket.assignee?.id !== me.id && (
              <Button
                variant="subtle"
                size="compact-sm"
                mt={4}
                onClick={() => onChange({ assigneeId: me.id })}
                disabled={disabled}
              >
                Assumir
              </Button>
            )}
          </div>
          <div>
            <Select
              ref={companyRef}
              label="Unidade"
              placeholder="Sem unidade"
              data={options(companies.data, ticket.company)}
              value={ticket.company?.id ?? null}
              onChange={(value) => {
                if (!value || value === ticket.company?.id) return;
                onChange({
                  companyId: value,
                  ...(requesterWithoutCompany && applyToRequester
                    ? { applyCompanyToRequester: true }
                    : {}),
                });
              }}
              searchable
              allowDeselect={false}
              error={companyError}
              disabled={disabled}
            />
            {requesterWithoutCompany && !closed && (
              <Checkbox
                mt="xs"
                size="xs"
                label="Gravar também no cadastro do solicitante"
                checked={applyToRequester}
                onChange={(event) => setApplyToRequester(event.currentTarget.checked)}
              />
            )}
          </div>
          <Select
            label="Categoria"
            data={options(categories.data, ticket.category)}
            value={ticket.category.id}
            onChange={(value) => {
              if (value && value !== ticket.category.id) onChange({ categoryId: value });
            }}
            allowDeselect={false}
            disabled={disabled}
          />
        </Stack>
      </Paper>

      <Paper withBorder p="md" aria-label="Solicitante">
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">
          Solicitante
        </Text>
        <Group gap="xs">
          <Text fw={600}>{ticket.requester.name}</Text>
          {ticket.requester.isExternal && (
            <Badge size="xs" color="grape" variant="light">
              Terceiro
            </Badge>
          )}
        </Group>
        <Text size="sm">{ticket.requester.email}</Text>
        <Text size="sm" c="dimmed">
          {ticket.requester.company?.name ?? 'Sem unidade'}
          {ticket.requester.department ? ` · ${ticket.requester.department.name}` : ''}
        </Text>
      </Paper>
    </Stack>
  );
}
