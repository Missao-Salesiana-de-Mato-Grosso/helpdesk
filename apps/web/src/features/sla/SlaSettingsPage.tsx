import {
  Alert,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { BusinessInterval, Holiday, SlaPolicy, TicketPriority } from '@helpdesk/shared';
import { useState, type ReactNode } from 'react';
import { PRIORITY_LABEL } from '../tickets/format.ts';
import { WEEKDAYS, formatIntervals, parseIntervals } from './hours.ts';
import {
  useCreateHoliday,
  useDeleteHoliday,
  useHolidays,
  useSaveHours,
  useSavePolicies,
  useSlaSettings,
} from './queries.ts';

const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const formatDate = (date: string) => DATE.format(new Date(`${date}T00:00:00Z`));

/** T28: Administração → SLA. Metas em horas úteis; horário comercial; feriados. */
export function SlaSettingsPage() {
  const settings = useSlaSettings();
  return (
    <Stack maw={880}>
      <div>
        <Title order={1} size="h2">
          SLA
        </Title>
        <Text size="sm" c="dimmed">
          Prazos contados só em horário útil
          {settings.data ? ` (fuso ${settings.data.timeZone})` : ''}. Pendente pausa o relógio. Toda
          mudança recalcula os prazos dos tickets que não estão fechados.
        </Text>
      </div>
      {settings.isPending && <Loader aria-label="Carregando" />}
      {settings.error && (
        <Alert color="red" title="Não foi possível carregar">
          {settings.error.message}
        </Alert>
      )}
      {settings.data && (
        <>
          <PoliciesSection
            key={JSON.stringify(settings.data.policies)}
            policies={settings.data.policies}
          />
          <HoursSection key={JSON.stringify(settings.data.hours)} hours={settings.data.hours} />
        </>
      )}
      <HolidaysSection />
    </Stack>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <div>
          <Title order={2} size="h4">
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </div>
        {children}
      </Stack>
    </Paper>
  );
}

function SaveRow({
  error,
  pending,
  saved,
  disabled,
  onSave,
}: {
  error: Error | null;
  pending: boolean;
  saved: boolean;
  disabled?: boolean;
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
        {saved && (
          <Text size="sm" c="green">
            Salvo.
          </Text>
        )}
        <Button loading={pending} disabled={disabled} onClick={onSave}>
          Salvar
        </Button>
      </Group>
    </>
  );
}

const PRIORITY_ORDER: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const toHours = (minutes: number) => minutes / 60;
const toMinutes = (hours: number) => Math.round(hours * 60);

/** NumberInput devolve '' com o campo vazio. */
interface PolicyRow {
  priority: TicketPriority;
  first: number | string;
  resolution: number | string;
}

function PoliciesSection({ policies }: { policies: SlaPolicy[] }) {
  const save = useSavePolicies();
  const [rows, setRows] = useState(() =>
    PRIORITY_ORDER.map((priority): PolicyRow => {
      const policy = policies.find((item) => item.priority === priority);
      return {
        priority,
        first: policy ? toHours(policy.firstResponseMinutes) : '',
        resolution: policy ? toHours(policy.resolutionMinutes) : '',
      };
    }),
  );
  const complete = rows.every(
    (row) => typeof row.first === 'number' && typeof row.resolution === 'number',
  );
  const set = (priority: TicketPriority, field: 'first' | 'resolution', value: number | string) =>
    setRows((current) =>
      current.map((row) => (row.priority === priority ? { ...row, [field]: value } : row)),
    );

  return (
    <Section
      title="Metas por prioridade"
      description="Em horas úteis. Com o horário padrão, 1 dia útil = 8 h."
    >
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Prioridade</Table.Th>
            <Table.Th>1ª resposta (h)</Table.Th>
            <Table.Th>Resolução (h)</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.priority}>
              <Table.Td>{PRIORITY_LABEL[row.priority]}</Table.Td>
              {(['first', 'resolution'] as const).map((field) => (
                <Table.Td key={field}>
                  <NumberInput
                    aria-label={`${field === 'first' ? '1ª resposta' : 'Resolução'} — ${PRIORITY_LABEL[row.priority]}`}
                    value={row[field]}
                    onChange={(value) => set(row.priority, field, value)}
                    min={0.25}
                    step={0.5}
                    decimalScale={2}
                    decimalSeparator=","
                    w={120}
                  />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <SaveRow
        error={save.error}
        pending={save.isPending}
        saved={save.isSuccess}
        disabled={!complete}
        onSave={() =>
          save.mutate(
            rows.map((row) => ({
              priority: row.priority,
              firstResponseMinutes: toMinutes(Number(row.first)),
              resolutionMinutes: toMinutes(Number(row.resolution)),
            })),
          )
        }
      />
    </Section>
  );
}

function HoursSection({ hours }: { hours: BusinessInterval[] }) {
  const save = useSaveHours();
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(WEEKDAYS.map(({ weekday }) => [weekday, formatIntervals(hours, weekday)])),
  );
  const parsed = WEEKDAYS.map(({ weekday }) => ({
    weekday,
    result: parseIntervals(texts[weekday] ?? '', weekday),
  }));
  const intervals = parsed.flatMap(({ result }) => ('intervals' in result ? result.intervals : []));
  const valid = parsed.every(({ result }) => 'intervals' in result) && intervals.length > 0;

  return (
    <Section
      title="Horário comercial"
      description="Um ou mais intervalos por dia, separados por vírgula (ex.: 07:00–11:00, 13:00–17:00). Em branco = fechado."
    >
      <Stack gap="xs">
        {WEEKDAYS.map(({ weekday, label }) => {
          const result = parsed.find((item) => item.weekday === weekday)!.result;
          return (
            <TextInput
              key={weekday}
              label={label}
              placeholder="Fechado"
              value={texts[weekday] ?? ''}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setTexts((current) => ({ ...current, [weekday]: value }));
              }}
              error={'error' in result ? result.error : undefined}
              maw={360}
            />
          );
        })}
      </Stack>
      {intervals.length === 0 && (
        <Text size="sm" c="red">
          Informe ao menos um dia com atendimento.
        </Text>
      )}
      <SaveRow
        error={save.error}
        pending={save.isPending}
        saved={save.isSuccess}
        disabled={!valid}
        onSave={() => save.mutate(intervals)}
      />
    </Section>
  );
}

function HolidaysSection() {
  const holidays = useHolidays();
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  return (
    <Section
      title="Feriados"
      description="Um calendário único para todas as unidades. O dia inteiro fica fora do horário útil. Cadastre aqui os feriados estaduais e municipais."
    >
      <Group align="flex-end">
        <TextInput
          label="Data"
          type="date"
          value={date}
          onChange={(event) => setDate(event.currentTarget.value)}
          w={170}
        />
        <TextInput
          label="Nome"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          w={280}
        />
        <Button
          loading={create.isPending}
          disabled={!date || !name.trim()}
          onClick={() =>
            create.mutate(
              { date, name: name.trim() },
              {
                onSuccess: () => {
                  setDate('');
                  setName('');
                },
              },
            )
          }
        >
          Adicionar
        </Button>
      </Group>
      {(create.error ?? remove.error) && (
        <Alert color="red" title="Não foi possível salvar">
          {(create.error ?? remove.error)?.message}
        </Alert>
      )}
      {holidays.isPending && <Loader aria-label="Carregando feriados" />}
      {holidays.data && holidays.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum feriado cadastrado.
        </Text>
      )}
      {holidays.data && holidays.data.length > 0 && (
        <Table striped>
          <Table.Tbody>
            {holidays.data.map((holiday: Holiday) => (
              <Table.Tr key={holiday.id}>
                <Table.Td w={120}>{formatDate(holiday.date)}</Table.Td>
                <Table.Td>{holiday.name}</Table.Td>
                <Table.Td w={100}>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    aria-label={`Excluir ${holiday.name} (${formatDate(holiday.date)})`}
                    loading={remove.isPending && remove.variables === holiday.id}
                    onClick={() => remove.mutate(holiday.id)}
                  >
                    Excluir
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Section>
  );
}
