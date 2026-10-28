import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import type { NamedRef, UpdateUserInput, UserSummary } from '@helpdesk/shared';
import { useState } from 'react';
import { useMe } from '../../auth/useMe.ts';
import { useCompanies } from '../tickets/queries.ts';
import { useDepartments, useUpdateUser, useUsers } from './queries.ts';

const PAGE_SIZE = 25;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  agente: 'Agente',
};

const toOptions = (items: NamedRef[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

/** T15: busca e edição de usuários (unidade, departamento, terceiro, ativo). Papéis vêm do Zitadel. */
export function UsersPage() {
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const users = useUsers({ q: q || undefined, page, pageSize: PAGE_SIZE });
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const pages = users.data ? Math.ceil(users.data.total / PAGE_SIZE) : 0;

  return (
    <Stack>
      <Title order={1} size="h2">
        Usuários
      </Title>
      <TextInput
        label="Buscar"
        placeholder="Nome ou e-mail"
        value={search}
        onChange={(event) => {
          setSearch(event.currentTarget.value);
          setPage(1);
        }}
        maw={360}
      />

      {users.isPending && <Loader aria-label="Carregando" />}
      {users.error && (
        <Alert color="red" title="Não foi possível carregar">
          {users.error.message}
        </Alert>
      )}
      {users.data && users.data.items.length === 0 && (
        <Text c="dimmed" py="xl" ta="center">
          Nenhum usuário encontrado.
        </Text>
      )}

      {users.data && users.data.items.length > 0 && (
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>E-mail</Table.Th>
                <Table.Th>Papel</Table.Th>
                <Table.Th>Unidade</Table.Th>
                <Table.Th>Departamento</Table.Th>
                <Table.Th>Grupos</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.data.items.map((user) => (
                <Table.Tr key={user.id}>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      {user.name}
                      {!user.active && (
                        <Badge size="xs" color="gray">
                          Inativo
                        </Badge>
                      )}
                      {user.isExternal && (
                        <Badge size="xs" color="grape" variant="light">
                          Terceiro
                        </Badge>
                      )}
                      {user.accessStatus !== 'approved' && (
                        <Badge size="xs" color="yellow" variant="light">
                          {user.accessStatus === 'rejected' ? 'Recusado' : 'Aguardando liberação'}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{user.email}</Table.Td>
                  <Table.Td>
                    {user.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ') ||
                      'Solicitante'}
                  </Table.Td>
                  <Table.Td>{user.company?.name ?? '—'}</Table.Td>
                  <Table.Td>{user.department?.name ?? '—'}</Table.Td>
                  <Table.Td>{user.groups.map((group) => group.name).join(', ') || '—'}</Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="light" onClick={() => setEditing(user)}>
                      Editar
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} />}

      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function EditUserModal({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const { data: me } = useMe();
  const companies = useCompanies();
  const departments = useDepartments();
  const update = useUpdateUser();
  const [companyId, setCompanyId] = useState<string | null>(user.company?.id ?? null);
  const [departmentId, setDepartmentId] = useState<string | null>(user.department?.id ?? null);
  const [isExternal, setIsExternal] = useState(user.isExternal);
  const [active, setActive] = useState(user.active);
  const isSelf = me?.id === user.id;

  const save = () => {
    const data: UpdateUserInput = { isExternal, active };
    if (companyId) data.companyId = companyId;
    if (departmentId) data.departmentId = departmentId;
    update.mutate({ id: user.id, data }, { onSuccess: onClose });
  };

  return (
    <Modal opened onClose={onClose} title={`Editar ${user.name}`}>
      <Stack>
        <Text size="sm" c="dimmed">
          {user.email}. O papel (agente, supervisor, administrador) é definido no Zitadel.
        </Text>
        <Select
          label="Unidade"
          data={toOptions(companies.data)}
          value={companyId}
          onChange={setCompanyId}
          searchable
        />
        <Select
          label="Departamento"
          data={toOptions(departments.data)}
          value={departmentId}
          onChange={setDepartmentId}
          searchable
        />
        <Checkbox
          label="É terceiro (de fora da instituição)"
          checked={isExternal}
          onChange={(event) => setIsExternal(event.currentTarget.checked)}
        />
        <Checkbox
          label="Ativo"
          description={
            isSelf
              ? 'Você não pode inativar a própria conta.'
              : 'Inativo perde o acesso ao portal na hora e deixa de receber tickets.'
          }
          checked={active}
          disabled={isSelf}
          onChange={(event) => setActive(event.currentTarget.checked)}
        />
        {update.error && (
          <Alert color="red" title="Não foi possível salvar">
            {update.error.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={update.isPending} onClick={save}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
