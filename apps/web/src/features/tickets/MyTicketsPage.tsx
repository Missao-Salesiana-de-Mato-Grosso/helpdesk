import {
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import type { TicketStatus } from '@helpdesk/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from './StatusBadge.tsx';
import { formatDateTime } from './format.ts';
import { MY_TICKETS_PAGE_SIZE, useMyTickets } from './queries.ts';

const FILTERS = {
  andamento: { label: 'Em andamento', statuses: ['open', 'pending'] },
  encerrados: { label: 'Encerrados', statuses: ['resolved', 'closed'] },
  todos: { label: 'Todos', statuses: [] },
} as const satisfies Record<string, { label: string; statuses: readonly TicketStatus[] }>;

type Filter = keyof typeof FILTERS;

const isFilter = (value: string): value is Filter => value in FILTERS;

/** "Meus tickets" (T11): os chamados que o usuário abriu (view `requested`). */
export function MyTicketsPage() {
  const [filter, setFilter] = useState<Filter>('andamento');
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const tickets = useMyTickets({ statuses: FILTERS[filter].statuses, q, page });

  const total = tickets.data?.total ?? 0;
  const pages = Math.ceil(total / MY_TICKETS_PAGE_SIZE);
  const filtered = filter !== 'todos' || q !== '';

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1} size="h2">
          Meus tickets
        </Title>
        <Button component={Link} to="/tickets/novo">
          Abrir chamado
        </Button>
      </Group>

      <Group>
        <SegmentedControl
          aria-label="Filtrar por situação"
          value={filter}
          onChange={(value) => {
            if (isFilter(value)) setFilter(value);
            setPage(1);
          }}
          data={Object.entries(FILTERS).map(([value, { label }]) => ({ value, label }))}
        />
        <TextInput
          aria-label="Buscar"
          placeholder="Buscar por número ou assunto"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
          w={280}
        />
      </Group>

      {tickets.isPending && <Loader aria-label="Carregando" />}
      {tickets.error && (
        <Alert color="red" title="Não foi possível carregar seus chamados">
          {tickets.error.message}
        </Alert>
      )}

      {tickets.data && total === 0 && (
        <Stack align="center" py="xl" gap="sm">
          <Text c="dimmed">
            {filtered ? 'Nenhum chamado encontrado.' : 'Você ainda não abriu chamados.'}
          </Text>
          {!filtered && (
            <Button component={Link} to="/tickets/novo" variant="light">
              Abrir chamado
            </Button>
          )}
        </Stack>
      )}

      {tickets.data && total > 0 && (
        <>
          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nº</Table.Th>
                  <Table.Th>Assunto</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th>Categoria</Table.Th>
                  <Table.Th>Unidade</Table.Th>
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
                      <StatusBadge status={ticket.status} />
                    </Table.Td>
                    <Table.Td>{ticket.category.name}</Table.Td>
                    <Table.Td>{ticket.company?.name ?? '—'}</Table.Td>
                    <Table.Td>{formatDateTime(ticket.updatedAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {pages > 1 && (
            <Pagination
              total={pages}
              value={page}
              onChange={setPage}
              getControlProps={(control) => ({
                'aria-label': control === 'previous' ? 'Página anterior' : 'Próxima página',
              })}
            />
          )}
        </>
      )}
    </Stack>
  );
}
