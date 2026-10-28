import {
  Alert,
  Button,
  Group,
  Loader,
  MultiSelect,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { useGroupMembers, useGroups } from '../tickets/queries.ts';
import { useReplaceGroupMembers, useUsers } from './queries.ts';

/** T15: membros de cada grupo. Só agentes ativos (papel de atendimento no Zitadel) aparecem. */
export function GroupsPage() {
  const groups = useGroups();
  const [groupId, setGroupId] = useState<string | null>(null);

  return (
    <Stack>
      <Title order={1} size="h2">
        Grupos
      </Title>
      {groups.error && (
        <Alert color="red" title="Não foi possível carregar">
          {groups.error.message}
        </Alert>
      )}
      <Select
        label="Grupo"
        placeholder="Escolha um grupo"
        data={(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))}
        value={groupId}
        onChange={setGroupId}
        searchable
        maw={360}
      />
      {groupId && <MembersEditor key={groupId} groupId={groupId} />}
    </Stack>
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
          Nenhum agente ativo. O papel de agente é dado no Zitadel (veja o runbook, §4).
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
