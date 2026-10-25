import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  MultiSelect,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type NamedRef,
  type TicketPriority,
  type TicketSort,
  type TicketStatus,
} from '@helpdesk/shared';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { QUEUE_VIEWS, type QueueSlug } from '../../layout/navigation.ts';
import { StatusBadge } from '../tickets/StatusBadge.tsx';
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_LABEL, formatDateTime } from '../tickets/format.ts';
import {
  QUEUE_PAGE_SIZE,
  useCompanies,
  useGroups,
  useQueue,
  useTicketCounters,
} from '../tickets/queries.ts';

const isQueueSlug = (value: string | undefined): value is QueueSlug =>
  value !== undefined && value in QUEUE_VIEWS;

const SORT_OPTIONS: { value: TicketSort; label: string }[] = [
  { value: 'updated_at:desc', label: 'Atualizados recentemente' },
  { value: 'created_at:asc', label: 'Mais antigos primeiro' },
  { value: 'created_at:desc', label: 'Mais novos primeiro' },
  { value: 'priority:desc', label: 'Maior prioridade' },
];

const isStatus = (value: string): value is TicketStatus =>
  (TICKET_STATUSES as readonly string[]).includes(value);
const isPriority = (value: string): value is TicketPriority =>
  (TICKET_PRIORITIES as readonly string[]).includes(value);
const isSort = (value: string | null): value is TicketSort =>
  SORT_OPTIONS.some((option) => option.value === value);

const toOptions = (items: NamedRef[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

/** Filas do agente (T12): `/fila/:view` (meus, grupo, sem-atribuicao, todos). */
export function QueuePage() {
  const { view } = useParams();
  if (!isQueueSlug(view)) return <Navigate to="/fila/meus" replace />;
  // `key` zera os filtros ao trocar de fila.
  return <Queue key={view} slug={view} />;
}

function Queue({ slug }: { slug: QueueSlug }) {
  const queue = QUEUE_VIEWS[slug];
  const [statuses, setStatuses] = useState<TicketStatus[]>(['open', 'pending']);
  const [priorities, setPriorities] = useState<TicketPriority[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [noCompany, setNoCompany] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 300);
  const [sort, setSort] = useState<TicketSort>('updated_at:desc');
  const [page, setPage] = useState(1);

  const companies = useCompanies();
  const groups = useGroups();
  const counters = useTicketCounters(true);
  const tickets = useQueue({
    view: queue.view,
    // Nenhuma situação marcada = todas (a API, sem filtro, mostraria só abertos e pendentes).
    statuses: statuses.length > 0 ? statuses : TICKET_STATUSES,
    priorities,
    companyId,
    noCompany,
    groupId: slug === 'todos' ? groupId : null,
    q,
    sort,
    page,
  });

  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };
  const total = tickets.data?.total ?? 0;
  const pages = Math.ceil(total / QUEUE_PAGE_SIZE);
  const noCompanyCount = counters.data?.noCompany;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1} size="h2">
          Fila — {queue.label}
        </Title>
        <Button
          variant={noCompany ? 'filled' : 'light'}
          color="red"
          aria-pressed={noCompany}
          onClick={() => reset(setNoCompany)(!noCompany)}
        >
          Sem unidade{noCompanyCount === undefined ? '' : ` (${noCompanyCount})`}
        </Button>
      </Group>

      <Group align="flex-end">
        <TextInput
          label="Buscar"
          placeholder="Número ou assunto"
          value={search}
          onChange={(event) => reset(setSearch)(event.currentTarget.value)}
          w={220}
        />
        <MultiSelect
          label="Situação"
          placeholder="Todas"
          data={TICKET_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))}
          value={statuses}
          onChange={(values) => reset(setStatuses)(values.filter(isStatus))}
          w={260}
        />
        <MultiSelect
          label="Prioridade"
          placeholder="Todas"
          data={TICKET_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }))}
          value={priorities}
          onChange={(values) => reset(setPriorities)(values.filter(isPriority))}
          w={220}
        />
        <Select
          label="Unidade"
          placeholder="Todas"
          data={toOptions(companies.data)}
          value={companyId}
          onChange={reset(setCompanyId)}
          disabled={noCompany}
          searchable
          clearable
          w={220}
        />
        {slug === 'todos' && (
          <Select
            label="Grupo"
            placeholder="Todos"
            data={toOptions(groups.data)}
            value={groupId}
            onChange={reset(setGroupId)}
            clearable
            w={200}
          />
        )}
        <Select
          label="Ordenar por"
          data={SORT_OPTIONS}
          value={sort}
          onChange={(value) => {
            if (isSort(value)) reset(setSort)(value);
          }}
          allowDeselect={false}
          w={220}
        />
      </Group>

      {tickets.isPending && <Loader aria-label="Carregando" />}
      {tickets.error && (
        <Alert color="red" title="Não foi possível carregar a fila">
          {tickets.error.message}
        </Alert>
      )}
      {tickets.data && total === 0 && (
        <Text c="dimmed" py="xl" ta="center">
          Nenhum chamado nesta fila.
        </Text>
      )}

      {tickets.data && total > 0 && (
        <>
          <Table.ScrollContainer minWidth={960}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nº</Table.Th>
                  <Table.Th>Assunto</Table.Th>
                  <Table.Th>Solicitante</Table.Th>
                  <Table.Th>Unidade</Table.Th>
                  <Table.Th>Grupo</Table.Th>
                  <Table.Th>Responsável</Table.Th>
                  <Table.Th>Prioridade</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th>Atualizado em</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tickets.data.items.map((ticket) => (
                  <Table.Tr key={ticket.id}>
                    <Table.Td>#{ticket.number}</Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/tickets/${ticket.id}`}>
                        {ticket.subject}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {ticket.requester.name}
                        {ticket.requester.isExternal && (
                          <Badge size="xs" color="grape" variant="light">
                            Terceiro
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {ticket.company?.name ?? (
                        <Badge color="red" variant="light">
                          Sem unidade
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{ticket.group.name}</Table.Td>
                    <Table.Td>{ticket.assignee?.name ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={PRIORITY_COLOR[ticket.priority]} variant="dot">
                        {PRIORITY_LABEL[ticket.priority]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={ticket.status} />
                    </Table.Td>
                    <Table.Td>{formatDateTime(ticket.updatedAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} />}
        </>
      )}
    </Stack>
  );
}
