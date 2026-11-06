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
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { CatalogItem, CategoryItem } from '@helpdesk/shared';
import { useState, type ReactNode } from 'react';
import { useCatalog, useSaveCatalogItem } from './queries.ts';

// T25: cadastros de referência. Não há excluir: desativar tira o item das listas de escolha, mas
// ele continua nos tickets e usuários que já o usam.

/** `null`: modal fechado; `'new'`: criando; item: editando. */
type Editing<T> = T | 'new' | null;

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge size="sm" color="teal" variant="light">
      Ativo
    </Badge>
  ) : (
    <Badge size="sm" color="gray">
      Inativo
    </Badge>
  );
}

const ACTIVE_HELP = 'Inativo some das listas de escolha; quem já usa continua com ele.';

/** Cabeçalho, carregamento, erro e lista vazia comuns às páginas de cadastro. */
export function CatalogLayout({
  title,
  description,
  newLabel,
  onNew,
  query,
  children,
}: {
  title: string;
  description: string;
  newLabel: string;
  onNew: () => void;
  query: { isPending: boolean; error: Error | null; data?: unknown[] };
  children: ReactNode;
}) {
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={1} size="h2">
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </div>
        <Button onClick={onNew}>{newLabel}</Button>
      </Group>
      {query.isPending && <Loader aria-label="Carregando" />}
      {query.error && (
        <Alert color="red" title="Não foi possível carregar">
          {query.error.message}
        </Alert>
      )}
      {query.data?.length === 0 && (
        <Text c="dimmed" py="xl" ta="center">
          Nenhum cadastro ainda.
        </Text>
      )}
      {children}
    </Stack>
  );
}

// ───────────── unidades e departamentos ─────────────

const SIMPLE = {
  companies: {
    title: 'Unidades',
    description: 'Escolas e obras. O solicitante escolhe a sua no 1º acesso.',
    newLabel: 'Nova unidade',
  },
  departments: {
    title: 'Departamentos',
    description: 'Setores. O solicitante escolhe o seu no 1º acesso.',
    newLabel: 'Novo departamento',
  },
} as const;

type SimpleKind = keyof typeof SIMPLE;

export const CompaniesPage = () => <SimpleCatalogPage kind="companies" />;
export const DepartmentsPage = () => <SimpleCatalogPage kind="departments" />;

function SimpleCatalogPage({ kind }: { kind: SimpleKind }) {
  const texts = SIMPLE[kind];
  const items = useCatalog(kind);
  const [editing, setEditing] = useState<Editing<CatalogItem>>(null);

  return (
    <CatalogLayout {...texts} onNew={() => setEditing('new')} query={items}>
      {items.data && items.data.length > 0 && (
        <Table striped highlightOnHover maw={720}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nome</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.data.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>{item.name}</Table.Td>
                <Table.Td>
                  <StatusBadge active={item.active} />
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => setEditing(item)}>
                    Editar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {editing && (
        <SimpleItemModal
          kind={kind}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </CatalogLayout>
  );
}

function SimpleItemModal({
  kind,
  item,
  onClose,
}: {
  kind: SimpleKind;
  item: CatalogItem | null;
  onClose: () => void;
}) {
  const save = useSaveCatalogItem(kind);
  const [name, setName] = useState(item?.name ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const { newLabel } = SIMPLE[kind];

  const submit = () => {
    const trimmed = name.trim();
    if (item) {
      const data = { ...(trimmed !== item.name ? { name: trimmed } : {}), active };
      save.mutate({ id: item.id, data }, { onSuccess: onClose });
    } else {
      save.mutate({ data: { name: trimmed } }, { onSuccess: onClose });
    }
  };

  return (
    <Modal opened onClose={onClose} title={item ? `Editar ${item.name}` : newLabel}>
      <Stack>
        <TextInput
          label="Nome"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          description={item ? 'Renomear mantém os vínculos com usuários e tickets.' : undefined}
          data-autofocus
        />
        {item && (
          <Checkbox
            label="Ativo"
            description={ACTIVE_HELP}
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

export function SaveFooter({
  error,
  pending,
  disabled,
  onCancel,
  onSave,
}: {
  error: Error | null;
  pending: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      {error && (
        <Alert color="red" title="Não foi possível salvar">
          {error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="subtle" onClick={onCancel}>
          Cancelar
        </Button>
        <Button loading={pending} disabled={disabled} onClick={onSave}>
          Salvar
        </Button>
      </Group>
    </>
  );
}

// ───────────── categorias ─────────────

export function CategoriesPage() {
  const categories = useCatalog('categories');
  const [editing, setEditing] = useState<Editing<CategoryItem>>(null);

  return (
    <CatalogLayout
      title="Categorias"
      description="O solicitante escolhe a categoria ao abrir o ticket; o ticket vai para o grupo padrão dela."
      newLabel="Nova categoria"
      onNew={() => setEditing('new')}
      query={categories}
    >
      {categories.data && categories.data.length > 0 && (
        <Table striped highlightOnHover maw={880}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nome</Table.Th>
              <Table.Th>Grupo padrão</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {categories.data.map((category) => (
              <Table.Tr key={category.id}>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {category.name}
                    {category.locked && (
                      <Badge size="xs" variant="light">
                        Padrão do e-mail
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {category.defaultGroup.name}
                  {!category.defaultGroup.active && ' (inativo)'}
                </Table.Td>
                <Table.Td>
                  <StatusBadge active={category.active} />
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => setEditing(category)}>
                    Editar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {editing && (
        <CategoryModal
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </CatalogLayout>
  );
}

function CategoryModal({
  category,
  onClose,
}: {
  category: CategoryItem | null;
  onClose: () => void;
}) {
  const groups = useCatalog('groups');
  const save = useSaveCatalogItem('categories');
  const [name, setName] = useState(category?.name ?? '');
  const [groupId, setGroupId] = useState<string | null>(category?.defaultGroup.id ?? null);
  const [active, setActive] = useState(category?.active ?? true);
  const locked = category?.locked ?? false;

  // Grupo inativo não recebe ticket: aparece (para mostrar o atual), mas não pode ser escolhido.
  const groupOptions = (groups.data ?? []).map((group) => ({
    value: group.id,
    label: group.active ? group.name : `${group.name} (inativo)`,
    disabled: !group.active,
  }));

  const submit = () => {
    const trimmed = name.trim();
    if (category) {
      const data = {
        ...(trimmed !== category.name ? { name: trimmed } : {}),
        ...(groupId && groupId !== category.defaultGroup.id ? { defaultGroupId: groupId } : {}),
        ...(active !== category.active ? { active } : {}),
      };
      if (Object.keys(data).length === 0) return onClose();
      save.mutate({ id: category.id, data }, { onSuccess: onClose });
    } else if (groupId) {
      save.mutate({ data: { name: trimmed, defaultGroupId: groupId } }, { onSuccess: onClose });
    }
  };

  return (
    <Modal opened onClose={onClose} title={category ? `Editar ${category.name}` : 'Nova categoria'}>
      <Stack>
        {locked && (
          <Text size="sm" c="dimmed">
            Os tickets abertos por e-mail entram nesta categoria: ela não pode ser renomeada nem
            desativada. O grupo padrão pode mudar.
          </Text>
        )}
        <TextInput
          label="Nome"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          disabled={locked}
          data-autofocus
        />
        <Select
          label="Grupo padrão"
          description="Para onde vão os tickets novos desta categoria."
          data={groupOptions}
          value={groupId}
          onChange={setGroupId}
          searchable
        />
        {category && (
          <Checkbox
            label="Ativo"
            description={ACTIVE_HELP}
            checked={active}
            disabled={locked}
            onChange={(event) => setActive(event.currentTarget.checked)}
          />
        )}
        <SaveFooter
          error={save.error}
          pending={save.isPending}
          disabled={!name.trim() || !groupId}
          onCancel={onClose}
          onSave={submit}
        />
      </Stack>
    </Modal>
  );
}
