import { Alert, Button, Code, Group, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { CANNED_VARIABLES, type CannedResponse } from '@helpdesk/shared';
import { useState } from 'react';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import { CatalogLayout, SaveFooter } from '../admin/CatalogPages.tsx';
import { useCannedResponses, useDeleteCannedResponse, useSaveCannedResponse } from './queries.ts';

/** Começo do texto, sem as tags, para a lista. */
const preview = (html: string) => {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

/** T26: respostas prontas — admin e supervisor mantêm; os agentes inserem no ticket. */
export function CannedResponsesPage() {
  const canned = useCannedResponses();
  const [editing, setEditing] = useState<CannedResponse | 'new' | null>(null);

  return (
    <CatalogLayout
      title="Respostas prontas"
      description="Textos que os agentes inserem na resposta ou na nota com um clique."
      newLabel="Nova resposta"
      onNew={() => setEditing('new')}
      query={canned}
    >
      {canned.data && canned.data.length > 0 && (
        <Table striped highlightOnHover maw={960}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Título</Table.Th>
              <Table.Th>Texto</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {canned.data.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>{item.title}</Table.Td>
                <Table.Td c="dimmed">{preview(item.bodyHtml)}</Table.Td>
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
        <CannedResponseModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </CatalogLayout>
  );
}

function CannedResponseModal({
  item,
  onClose,
}: {
  item: CannedResponse | null;
  onClose: () => void;
}) {
  const save = useSaveCannedResponse();
  const remove = useDeleteCannedResponse();
  const [title, setTitle] = useState(item?.title ?? '');
  const [bodyHtml, setBodyHtml] = useState(item?.bodyHtml ?? '');
  const [confirming, setConfirming] = useState(false);

  const submit = () => {
    const trimmed = title.trim();
    if (item) {
      const data = {
        ...(trimmed !== item.title ? { title: trimmed } : {}),
        ...(bodyHtml !== item.bodyHtml ? { bodyHtml } : {}),
      };
      if (Object.keys(data).length === 0) return onClose();
      save.mutate({ id: item.id, data }, { onSuccess: onClose });
    } else {
      save.mutate({ data: { title: trimmed, bodyHtml } }, { onSuccess: onClose });
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={item ? `Editar ${item.title}` : 'Nova resposta pronta'}
      size="lg"
    >
      <Stack>
        <TextInput
          label="Título"
          description="É por ele que o agente busca a resposta."
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          data-autofocus
        />
        <HtmlEditor label="Texto" value={bodyHtml} onChange={setBodyHtml} />
        <Text size="xs" c="dimmed">
          Variáveis, trocadas ao inserir no ticket:{' '}
          {Object.entries(CANNED_VARIABLES).map(([key, help], index) => (
            <span key={key}>
              {index > 0 && ' · '}
              <Code>{`{{${key}}}`}</Code> {help.toLowerCase()}
            </span>
          ))}
        </Text>
        {item && confirming && (
          <Alert color="red" title="Excluir esta resposta?">
            <Stack gap="xs">
              <Text size="sm">
                Ela some da lista dos agentes. As mensagens já enviadas com ela não mudam.
              </Text>
              {remove.error && <Text size="sm">{remove.error.message}</Text>}
              <Group>
                <Button
                  color="red"
                  size="xs"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(item.id, { onSuccess: onClose })}
                >
                  Excluir
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setConfirming(false)}>
                  Manter
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}
        {item && !confirming && (
          <Group>
            <Button color="red" variant="subtle" size="xs" onClick={() => setConfirming(true)}>
              Excluir resposta
            </Button>
          </Group>
        )}
        <SaveFooter
          error={save.error}
          pending={save.isPending}
          disabled={!title.trim() || bodyHtml === ''}
          onCancel={onClose}
          onSave={submit}
        />
      </Stack>
    </Modal>
  );
}
