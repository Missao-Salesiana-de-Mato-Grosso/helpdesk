import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import type { AccessRequestSummary, NamedRef } from '@helpdesk/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/api-context.ts';
import { useMe } from '../../auth/useMe.ts';
import { useCompanies } from '../tickets/queries.ts';
import { formatDateTime } from '../tickets/format.ts';
import {
  useAccessRequests,
  useApproveAccess,
  useEmptyTrash,
  useRejectAccess,
  useRestoreAccess,
  useTrashAccess,
  type AccessRequestsStatus,
} from './queries.ts';

const toOptions = (items: NamedRef[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

const isAccessRequestsStatus = (value: string | null): value is AccessRequestsStatus =>
  value === 'pending' || value === 'trashed';

function useDepartments() {
  const api = useApi();
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => api<NamedRef[]>('/departments'),
    staleTime: 5 * 60_000,
  });
}

/** T22 RN-10: fila de liberação de acesso. "Admin" na spec inclui `supervisor`; excluir/esvaziar a lixeira é só `admin`. */
export function AccessRequestsPage() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<AccessRequestsStatus>('pending');
  const requests = useAccessRequests(status);
  const isAdmin = me?.roles.includes('admin') ?? false;

  return (
    <Stack>
      <Title order={1} size="h2">
        Liberação de acesso
      </Title>

      <Tabs
        value={status}
        onChange={(value) => {
          if (isAccessRequestsStatus(value)) setStatus(value);
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="pending">Fila</Tabs.Tab>
          <Tabs.Tab value="trashed">Lixeira</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {requests.isPending && <Loader aria-label="Carregando" />}
      {requests.error && (
        <Alert color="red" title="Não foi possível carregar">
          {requests.error.message}
        </Alert>
      )}
      {requests.data && requests.data.items.length === 0 && (
        <Text c="dimmed" py="xl" ta="center">
          {status === 'pending' ? 'Nenhum pedido pendente.' : 'A lixeira está vazia.'}
        </Text>
      )}

      {requests.data && requests.data.items.length > 0 && (
        <>
          {status === 'trashed' && isAdmin && <EmptyTrashButton />}
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nome</Table.Th>
                  <Table.Th>E-mail</Table.Th>
                  <Table.Th>Unidade sugerida</Table.Th>
                  <Table.Th>Departamento sugerido</Table.Th>
                  <Table.Th>Pedido em</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {requests.data.items.map((item) => (
                  <Row key={item.id} item={item} status={status} isAdmin={isAdmin} />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </Stack>
  );
}

function EmptyTrashButton() {
  const [open, setOpen] = useState(false);
  const emptyTrash = useEmptyTrash();
  return (
    <Group justify="flex-end">
      <Button color="red" variant="light" onClick={() => setOpen(true)}>
        Esvaziar lixeira
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Esvaziar a lixeira">
        <Stack>
          <Text size="sm">
            Exclui definitivamente todos os pedidos da lixeira. Quem já ganhou um ticket entretanto
            volta para a fila em vez de ser excluído.
          </Text>
          {emptyTrash.error && (
            <Alert color="red" title="Não foi possível esvaziar">
              {emptyTrash.error.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              color="red"
              loading={emptyTrash.isPending}
              onClick={() => emptyTrash.mutate(undefined, { onSuccess: () => setOpen(false) })}
            >
              Esvaziar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Group>
  );
}

function Row({
  item,
  status,
  isAdmin,
}: {
  item: AccessRequestSummary;
  status: AccessRequestsStatus;
  isAdmin: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const restore = useRestoreAccess();
  const trash = useTrashAccess();

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {item.name}
          {item.isExternalDomain && (
            <Badge size="xs" color="grape" variant="light">
              Fora do domínio
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>{item.email}</Table.Td>
      <Table.Td>{item.company?.name ?? '—'}</Table.Td>
      <Table.Td>{item.department?.name ?? '—'}</Table.Td>
      <Table.Td>{formatDateTime(item.accessRequestedAt)}</Table.Td>
      <Table.Td>
        {status === 'pending' ? (
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" onClick={() => setApproveOpen(true)}>
              Aprovar
            </Button>
            <Button size="xs" color="red" variant="light" onClick={() => setRejectOpen(true)}>
              Recusar
            </Button>
          </Group>
        ) : (
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" loading={restore.isPending} onClick={() => restore.mutate(item.id)}>
              Restaurar
            </Button>
            {isAdmin && (
              <Button
                size="xs"
                color="red"
                variant="light"
                loading={trash.isPending}
                onClick={() => trash.mutate(item.id)}
              >
                Excluir
              </Button>
            )}
          </Group>
        )}
      </Table.Td>
      {approveOpen && <ApproveModal item={item} onClose={() => setApproveOpen(false)} />}
      {rejectOpen && <RejectModal item={item} onClose={() => setRejectOpen(false)} />}
    </Table.Tr>
  );
}

function ApproveModal({ item, onClose }: { item: AccessRequestSummary; onClose: () => void }) {
  const companies = useCompanies();
  const departments = useDepartments();
  const [companyId, setCompanyId] = useState<string | null>(item.company?.id ?? null);
  const [departmentId, setDepartmentId] = useState<string | null>(item.department?.id ?? null);
  const [isExternal, setIsExternal] = useState(false);
  const approve = useApproveAccess();

  return (
    <Modal opened onClose={onClose} title={`Aprovar ${item.name}`}>
      <Stack>
        <Select
          label="Unidade"
          data={toOptions(companies.data)}
          value={companyId}
          onChange={setCompanyId}
          searchable
          required
        />
        <Select
          label="Departamento"
          data={toOptions(departments.data)}
          value={departmentId}
          onChange={setDepartmentId}
          searchable
          required
        />
        <Checkbox
          label="É terceiro (de fora da instituição)"
          checked={isExternal}
          onChange={(event) => setIsExternal(event.currentTarget.checked)}
        />
        {approve.error && (
          <Alert color="red" title="Não foi possível aprovar">
            {approve.error.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!companyId || !departmentId}
            loading={approve.isPending}
            onClick={() =>
              companyId &&
              departmentId &&
              approve.mutate(
                { id: item.id, data: { companyId, departmentId, isExternal } },
                { onSuccess: onClose },
              )
            }
          >
            Aprovar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RejectModal({ item, onClose }: { item: AccessRequestSummary; onClose: () => void }) {
  const [note, setNote] = useState('');
  const reject = useRejectAccess();

  return (
    <Modal opened onClose={onClose} title={`Recusar ${item.name}`}>
      <Stack>
        <Textarea
          label="Nota interna (opcional, nunca é mostrada ao usuário)"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          maxLength={500}
          autosize
          minRows={2}
        />
        {reject.error && (
          <Alert color="red" title="Não foi possível recusar">
            {reject.error.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            color="red"
            loading={reject.isPending}
            onClick={() =>
              reject.mutate(
                { id: item.id, data: { note: note.trim() || undefined } },
                { onSuccess: onClose },
              )
            }
          >
            Recusar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
