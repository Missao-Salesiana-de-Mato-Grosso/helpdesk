import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { GroupItem } from '@helpdesk/shared';
import { useState } from 'react';
import { useGroupMembers } from '../tickets/queries.ts';
import { CatalogLayout, SaveFooter, StatusBadge } from './CatalogPages.tsx';
import { useCatalog, useReplaceGroupMembers, useSaveCatalogItem, useUsers } from './queries.ts';

/**
 * T25: cadastro de grupos (nome, e-mail de aviso, ativo). T15: membros de cada grupo; só agentes
 * ativos (com papel de atendimento) aparecem.
 */
export function GroupsPage() {
  const groups = useCatalog('groups');
  const [editing, setEditing] = useState<GroupItem | 'new' | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const activeGroups = (groups.data ?? []).filter((group) => group.active);

  return (
    <CatalogLayout
      title="Grupos"
      description="Filas de atendimento. Cada categoria manda os tickets novos para o seu grupo padrão."
      newLabel="Novo grupo"
      onNew={() => setEditing('new')}
      query={groups}
    >
      {groups.data && groups.data.length > 0 && (
        <Table striped highlightOnHover maw={880}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nome</Table.Th>
              <Table.Th>E-mail de aviso</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.data.map((group) => (
              <Table.Tr key={group.id}>
                <Table.Td>{group.name}</Table.Td>
                <Table.Td>{group.email ?? '—'}</Table.Td>
                <Table.Td>
                  <StatusBadge active={group.active} />
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => setEditing(group)}>
                    Editar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Title order={2} size="h3" mt="md">
        Membros
      </Title>
      <Select
        label="Grupo"
        placeholder="Escolha um grupo"
        data={activeGroups.map((group) => ({ value: group.id, label: group.name }))}
        value={groupId}
        onChange={setGroupId}
        searchable
        maw={360}
      />
      {groupId && <MembersEditor key={groupId} groupId={groupId} />}

      {editing && (
        <GroupModal group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </CatalogLayout>
  );
}

function GroupModal({ group, onClose }: { group: GroupItem | null; onClose: () => void }) {
  const save = useSaveCatalogItem('groups');
  const [name, setName] = useState(group?.name ?? '');
  const [email, setEmail] = useState(group?.email ?? '');
  const [active, setActive] = useState(group?.active ?? true);

  const submit = () => {
    const trimmed = name.trim();
    const mail = email.trim() || null;
    if (group) {
      const data = {
        ...(trimmed !== group.name ? { name: trimmed } : {}),
        ...(mail !== group.email ? { email: mail } : {}),
        ...(active !== group.active ? { active } : {}),
      };
      if (Object.keys(data).length === 0) return onClose();
      save.mutate({ id: group.id, data }, { onSuccess: onClose });
    } else {
      save.mutate({ data: { name: trimmed, email: mail } }, { onSuccess: onClose });
    }
  };

  return (
    <Modal opened onClose={onClose} title={group ? `Editar ${group.name}` : 'Novo grupo'}>
      <Stack>
        <TextInput
          label="Nome"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          data-autofocus
        />
        <TextInput
          label="E-mail de aviso (opcional)"
          description="Recebe o aviso de ticket novo na fila, além dos membros do grupo."
          type="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        {group && (
          <Checkbox
            label="Ativo"
            description="Inativo deixa de receber tickets novos. Não dá para desativar o grupo padrão de uma categoria ativa."
            checked={active}
            onChange={(event) => setActive(event.currentTarget.checked)}
          />
        )}
        <SaveFooter
          error={save.error}
          pending={save.isPending}
          disabled={!name.trim()}
          onCancel={onClose}
          onSave={submit}
        />
      </Stack>
    </Modal>
  );
}

function MembersEditor({ groupId }: { groupId: string }) {
  const members = useGroupMembers(groupId);
  // ~20 agentes: uma página basta.
  const agents = useUsers({ role: 'agent', pageSize: 100 });

  const error = members.error ?? agents.error;
  if (error) {
    return (
      <Alert color="red" title="Não foi possível carregar">
        {error.message}
      </Alert>
    );
  }
  if (!members.data || !agents.data) return <Loader aria-label="Carregando" />;

  const options = agents.data.items
    .filter((user) => user.active)
    .map((user) => ({ value: user.id, label: `${user.name} (${user.email})` }));
  return (
    <MembersForm
      groupId={groupId}
      saved={members.data.map((member) => member.id)}
      options={options}
    />
  );
}

function MembersForm({
  groupId,
  saved,
  options,
}: {
  groupId: string;
  saved: string[];
  options: { value: string; label: string }[];
}) {
  const replace = useReplaceGroupMembers(groupId);
  const [selected, setSelected] = useState(saved);
  const changed = saved.length !== selected.length || saved.some((id) => !selected.includes(id));

  return (
    <Stack maw={560}>
      <MultiSelect
        label="Membros"
        description="Agentes que recebem os tickets deste grupo e veem a fila dele."
        data={options}
        value={selected}
        onChange={setSelected}
        searchable
        clearable
      />
      {options.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum agente ativo. O papel de agente se dá em Administração → Usuários (runbook, §4).
        </Text>
      )}
      {replace.error && (
        <Alert color="red" title="Não foi possível salvar">
          {replace.error.message}
        </Alert>
      )}
      {replace.isSuccess && !changed && (
        <Text size="sm" c="teal">
          Membros salvos.
        </Text>
      )}
      <Group>
        <Button
          disabled={!changed}
          loading={replace.isPending}
          onClick={() => replace.mutate(selected)}
        >
          Salvar membros
        </Button>
        <Button variant="subtle" disabled={!changed} onClick={() => setSelected(saved)}>
          Desfazer
        </Button>
      </Group>
    </Stack>
  );
}
