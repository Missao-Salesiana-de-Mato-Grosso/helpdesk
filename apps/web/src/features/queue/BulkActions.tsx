import { Alert, Button, Group, Modal, Paper, Select, Stack, Text } from '@mantine/core';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type BulkUpdateField,
  type NamedRef,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
} from '@helpdesk/shared';
import { useState } from 'react';
import { useMe } from '../../auth/useMe.ts';
import { toOutcome, type BulkChanges, type BulkOutcome } from './bulk-outcome.ts';
import { PRIORITY_LABEL, STATUS_LABEL } from '../tickets/format.ts';
import {
  useBulkUpdateTickets,
  useCategories,
  useCompanies,
  useGroupMembers,
  useGroups,
} from '../tickets/queries.ts';

type Changes = BulkChanges;

/** Spec T35. Rótulo do campo e artigo, para a frase da confirmação (RN-20). */
const FIELDS: { value: BulkUpdateField; label: string; noun: string; newLabel: string }[] = [
  { value: 'status', label: 'Situação', noun: 'a situação', newLabel: 'Nova situação' },
  { value: 'priority', label: 'Prioridade', noun: 'a prioridade', newLabel: 'Nova prioridade' },
  { value: 'groupId', label: 'Grupo', noun: 'o grupo', newLabel: 'Novo grupo' },
  {
    value: 'assigneeId',
    label: 'Responsável',
    noun: 'o responsável',
    newLabel: 'Novo responsável',
  },
  { value: 'categoryId', label: 'Categoria', noun: 'a categoria', newLabel: 'Nova categoria' },
  { value: 'companyId', label: 'Unidade', noun: 'a unidade', newLabel: 'Nova unidade' },
];

const NO_ASSIGNEE = '__nobody__';

const isStatus = (value: string): value is TicketStatus =>
  (TICKET_STATUSES as readonly string[]).includes(value);
const isPriority = (value: string): value is TicketPriority =>
  (TICKET_PRIORITIES as readonly string[]).includes(value);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const selectedLabel = (count: number) => plural(count, 'selecionado', 'selecionados');
const ticketsLabel = (count: number) => plural(count, 'chamado', 'chamados');

const toOptions = (items: NamedRef[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

interface BulkActionsProps {
  /** Chamados marcados que estão na página (RN-16). */
  selected: TicketSummary[];
  onClear: () => void;
  onDone: (outcome: BulkOutcome) => Promise<void> | void;
}

/** Barra de ações em lote da fila (RN-17 a RN-20). */
export function BulkActions({ selected, onClear, onDone }: BulkActionsProps) {
  const [dialog, setDialog] = useState<'close' | 'change' | null>(null);
  const update = useBulkUpdateTickets();

  const apply = (changes: Changes) => {
    // A versão vem da lista carregada no momento de enviar (RN-16).
    const snapshot = selected;
    const tickets = snapshot.map(({ id, version }) => ({ id, version }));
    update.mutate(
      { tickets, changes },
      {
        onSuccess: async (response) => {
          setDialog(null);
          await onDone(toOutcome(response, snapshot, changes));
        },
      },
    );
  };
  const close = () => {
    update.reset();
    setDialog(null);
  };

  return (
    <Paper withBorder p="xs" role="region" aria-label="Ações em lote">
      <Group justify="space-between">
        <Text fw={500}>{selectedLabel(selected.length)}</Text>
        <Group gap="xs">
          <Button variant="subtle" onClick={onClear}>
            Limpar seleção
          </Button>
          <Button variant="light" color="red" onClick={() => setDialog('close')}>
            Fechar
          </Button>
          <Button onClick={() => setDialog('change')}>Alterar…</Button>
        </Group>
      </Group>

      {dialog === 'close' && (
        <Modal opened onClose={close} title={`Fechar ${ticketsLabel(selected.length)}?`}>
          <Stack>
            <Text>Chamado fechado não pode mais ser alterado.</Text>
            <RequestError error={update.error} />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancelar
              </Button>
              <Button
                color="red"
                loading={update.isPending}
                onClick={() => apply({ status: 'closed' })}
              >
                Fechar chamados
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}

      {dialog === 'change' && (
        <ChangeModal
          selected={selected}
          pending={update.isPending}
          error={update.error}
          onCancel={close}
          onApply={apply}
        />
      )}
    </Paper>
  );
}

function RequestError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <Alert color="red" title="Não foi possível alterar os chamados">
      {error.message}
    </Alert>
  );
}

interface ChangeModalProps {
  selected: TicketSummary[];
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onApply: (changes: Changes) => void;
}

/** RN-18: primeiro o campo, depois o valor; RN-20: confirmação com o resumo. */
function ChangeModal({ selected, pending, error, onCancel, onApply }: ChangeModalProps) {
  const [field, setField] = useState<BulkUpdateField | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const values = useFieldOptions(field, selected);

  const chosen = FIELDS.find((item) => item.value === field);
  const valueLabel = values.find((option) => option.value === value)?.label;

  const changes = (): Changes | null => {
    if (!field || value === null) return null;
    if (field === 'assigneeId') return { assigneeId: value === NO_ASSIGNEE ? null : value };
    if (field === 'status') return isStatus(value) ? { status: value } : null;
    if (field === 'priority') return isPriority(value) ? { priority: value } : null;
    return { [field]: value };
  };
  const ready = changes() !== null;

  return (
    <Modal opened onClose={onCancel} title={`Alterar ${ticketsLabel(selected.length)}`}>
      {confirming && chosen && valueLabel ? (
        <Stack>
          <Text>
            Alterar {chosen.noun} de {ticketsLabel(selected.length)} para {valueLabel}?
          </Text>
          {field === 'status' && value === 'closed' && (
            <Text c="dimmed" size="sm">
              Chamado fechado não pode mais ser alterado.
            </Text>
          )}
          <RequestError error={error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button
              loading={pending}
              onClick={() => {
                const picked = changes();
                if (picked) onApply(picked);
              }}
            >
              Confirmar
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Select
            label="O que alterar"
            placeholder="Escolha um campo"
            data={FIELDS.map(({ value: option, label }) => ({ value: option, label }))}
            value={field}
            onChange={(next) => {
              setField(FIELDS.find((item) => item.value === next)?.value ?? null);
              setValue(null); // RN-18: trocar o campo descarta o valor anterior.
            }}
            allowDeselect={false}
            data-autofocus
          />
          {chosen && (
            <Select
              label={chosen.newLabel}
              placeholder="Escolha o valor"
              data={values}
              value={value}
              onChange={setValue}
              searchable
              allowDeselect={false}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>
              Cancelar
            </Button>
            <Button disabled={!ready} onClick={() => setConfirming(true)}>
              Aplicar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Grupo comum a todos os marcados, ou `null` se forem de grupos diferentes (RN-19). */
function commonGroup(selected: TicketSummary[]): string | null {
  const first = selected[0]?.group.id;
  return first && selected.every((ticket) => ticket.group.id === first) ? first : null;
}

function useFieldOptions(field: BulkUpdateField | null, selected: TicketSummary[]) {
  const groups = useGroups();
  const categories = useCategories();
  const companies = useCompanies();
  const me = useMe();
  const groupId = commonGroup(selected);
  const members = useGroupMembersIf(field === 'assigneeId' ? groupId : null);

  switch (field) {
    case 'status':
      return TICKET_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }));
    case 'priority':
      return TICKET_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }));
    case 'groupId':
      return toOptions(groups.data);
    case 'categoryId':
      return toOptions(categories.data);
    case 'companyId':
      return toOptions(companies.data);
    case 'assigneeId': {
      const meId = me.data?.id;
      return [
        { value: NO_ASSIGNEE, label: 'Ninguém' },
        ...(meId ? [{ value: meId, label: 'Eu' }] : []),
        ...toOptions(members?.filter((member) => member.id !== meId)),
      ];
    }
    default:
      return [];
  }
}

/** Membros do grupo comum; sem grupo comum, nenhum (só "Ninguém" e "Eu", RN-19). */
function useGroupMembersIf(groupId: string | null): NamedRef[] | undefined {
  // O hook de membros exige um id; com grupo nulo a consulta fica desligada.
  const members = useGroupMembers(groupId ?? '', groupId !== null);
  return groupId === null ? undefined : members.data;
}
