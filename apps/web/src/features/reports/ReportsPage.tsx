import { LineChart } from '@mantine/charts';
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { ReportRow, ReportSummary, TicketSource } from '@helpdesk/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/api-context.ts';
import { PRIORITY_LABEL } from '../tickets/format.ts';
import { useGroups } from '../tickets/queries.ts';
import {
  downloadText,
  formatDuration,
  formatRate,
  presetRange,
  PRESETS,
  reportCsv,
  type ReportPreset,
} from './report-format.ts';

const SOURCE_LABEL: Record<TicketSource, string> = {
  portal: 'Portal',
  email: 'E-mail',
  agent: 'Aberto por agente',
};

const BREAKDOWNS = [
  { key: 'byGroup', label: 'Grupo', file: 'grupos' },
  { key: 'byAgent', label: 'Agente', file: 'agentes' },
  { key: 'byCompany', label: 'Unidade', file: 'unidades' },
  { key: 'byCategory', label: 'Categoria', file: 'categorias' },
] as const satisfies readonly { key: keyof ReportSummary; label: string; file: string }[];

interface Filters {
  from: string;
  to: string;
  groupId: string | null;
}

function useReportSummary(filters: Filters) {
  const api = useApi();
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.groupId) params.set('groupId', filters.groupId);
  return useQuery({
    queryKey: ['reports', 'summary', filters],
    queryFn: () => api<ReportSummary>(`/reports/summary?${params.toString()}`),
    placeholderData: keepPreviousData,
    enabled: Boolean(filters.from && filters.to && filters.from <= filters.to),
  });
}

/** Spec T37: relatórios de atendimento, para supervisor e admin. */
export function ReportsPage() {
  const [preset, setPreset] = useState<ReportPreset | 'custom'>('30d');
  const [filters, setFilters] = useState<Filters>(() => ({
    ...presetRange('30d', new Date()),
    groupId: null,
  }));
  const groups = useGroups();
  const report = useReportSummary(filters);

  const choosePreset = (value: string) => {
    const found = PRESETS.find((item) => item.value === value);
    if (!found) return;
    setPreset(found.value);
    setFilters((current) => ({ ...current, ...presetRange(found.value, new Date()) }));
  };
  const setDate = (field: 'from' | 'to', value: string) => {
    setPreset('custom');
    setFilters((current) => ({ ...current, [field]: value }));
  };

  return (
    <Stack>
      <Title order={1} size="h2">
        Relatórios
      </Title>
      <Group align="flex-end" wrap="wrap">
        <SegmentedControl
          aria-label="Período"
          data={PRESETS}
          value={preset === 'custom' ? '' : preset}
          onChange={choosePreset}
        />
        <TextInput
          type="date"
          label="De"
          value={filters.from}
          onChange={(event) => setDate('from', event.currentTarget.value)}
        />
        <TextInput
          type="date"
          label="Até"
          value={filters.to}
          onChange={(event) => setDate('to', event.currentTarget.value)}
        />
        <Select
          label="Grupo"
          placeholder="Todos os grupos"
          data={(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))}
          value={filters.groupId}
          onChange={(groupId) => setFilters((current) => ({ ...current, groupId }))}
          clearable
          searchable
        />
      </Group>

      {report.error && (
        <Alert color="red" title="Não foi possível carregar o relatório">
          {report.error.message}
        </Alert>
      )}
      {!report.data && !report.error && <Loader aria-label="Carregando" />}
      {report.data && <ReportBody summary={report.data} />}
    </Stack>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card withBorder padding="sm">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="xl">
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

const rateHint = (met: number, evaluated: number) =>
  evaluated === 0 ? 'sem chamados com meta' : `${met} de ${evaluated} no prazo`;

function ReportBody({ summary }: { summary: ReportSummary }) {
  const { totals } = summary;
  const createdTotal = summary.bySource.reduce((sum, item) => sum + item.count, 0);
  const share = (count: number) =>
    createdTotal === 0 ? '—' : `${Math.round((count / createdTotal) * 100)}%`;

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Criados" value={totals.created} />
        <Stat label="Resolvidos" value={totals.resolved} hint={`${totals.closed} fechados`} />
        <Stat label="Em aberto agora" value={totals.openNow} />
        <Stat
          label="1ª resposta (mediana)"
          value={formatDuration(totals.firstResponse.median)}
          hint={`média ${formatDuration(totals.firstResponse.average)} · ${totals.firstResponse.count} chamados`}
        />
        <Stat
          label="Resolução (mediana)"
          value={formatDuration(totals.resolution.median)}
          hint={`média ${formatDuration(totals.resolution.average)} · ${totals.resolution.count} chamados`}
        />
        <Stat
          label="1ª resposta no prazo"
          value={formatRate(totals.firstResponseSla)}
          hint={rateHint(totals.firstResponseSla.met, totals.firstResponseSla.evaluated)}
        />
        <Stat
          label="Resolução no prazo"
          value={formatRate(totals.resolutionSla)}
          hint={rateHint(totals.resolutionSla.met, totals.resolutionSla.evaluated)}
        />
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        Tempos em horário útil, pelo calendário do SLA. Grupo e responsável são os atuais de cada
        chamado.
      </Text>

      <Card withBorder>
        <Title order={2} size="h4" mb="sm">
          Evolução {summary.bucket === 'week' ? 'por semana' : 'por dia'}
        </Title>
        <LineChart
          h={260}
          data={summary.series}
          dataKey="date"
          series={[
            { name: 'created', label: 'Criados', color: 'blue.6' },
            { name: 'resolved', label: 'Resolvidos', color: 'teal.6' },
          ]}
          withLegend
          curveType="linear"
        />
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder>
          <Title order={2} size="h4" mb="sm">
            Criados por canal
          </Title>
          <Table aria-label="Criados por canal">
            <Table.Tbody>
              {summary.bySource.map((item) => (
                <Table.Tr key={item.source}>
                  <Table.Td>{SOURCE_LABEL[item.source]}</Table.Td>
                  <Table.Td ta="right">{item.count}</Table.Td>
                  <Table.Td ta="right">{share(item.count)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
        <Card withBorder>
          <Title order={2} size="h4" mb="sm">
            Criados por prioridade
          </Title>
          <Table aria-label="Criados por prioridade">
            <Table.Tbody>
              {summary.byPriority.map((item) => (
                <Table.Tr key={item.priority}>
                  <Table.Td>{PRIORITY_LABEL[item.priority]}</Table.Td>
                  <Table.Td ta="right">{item.count}</Table.Td>
                  <Table.Td ta="right">{share(item.count)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </SimpleGrid>

      <Tabs defaultValue="byGroup">
        <Tabs.List>
          {BREAKDOWNS.map((item) => (
            <Tabs.Tab key={item.key} value={item.key}>
              Por {item.label.toLowerCase()}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {BREAKDOWNS.map((item) => (
          <Tabs.Panel key={item.key} value={item.key} pt="sm">
            <BreakdownTable
              label={item.label}
              rows={summary[item.key]}
              filename={`relatorio-${item.file}-${summary.from}-a-${summary.to}.csv`}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
}

function BreakdownTable({
  label,
  rows,
  filename,
}: {
  label: string;
  rows: ReportRow[];
  filename: string;
}) {
  if (rows.length === 0) {
    return <Text c="dimmed">Nenhum chamado no período.</Text>;
  }
  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <Button
          size="xs"
          variant="light"
          onClick={() => downloadText(filename, reportCsv(label, rows))}
        >
          Baixar CSV
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={760}>
        <Table striped aria-label={`Por ${label.toLowerCase()}`}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{label}</Table.Th>
              <Table.Th ta="right">Criados</Table.Th>
              <Table.Th ta="right">Resolvidos</Table.Th>
              <Table.Th ta="right">1ª resposta</Table.Th>
              <Table.Th ta="right">Resolução</Table.Th>
              <Table.Th ta="right">1ª resp. no prazo</Table.Th>
              <Table.Th ta="right">Resolução no prazo</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.id ?? 'none'}>
                <Table.Td>{row.active ? row.name : `${row.name} (inativo)`}</Table.Td>
                <Table.Td ta="right">{row.created}</Table.Td>
                <Table.Td ta="right">{row.resolved}</Table.Td>
                <Table.Td ta="right">{formatDuration(row.firstResponse.median)}</Table.Td>
                <Table.Td ta="right">{formatDuration(row.resolution.median)}</Table.Td>
                <Table.Td ta="right">{formatRate(row.firstResponseSla)}</Table.Td>
                <Table.Td ta="right">{formatRate(row.resolutionSla)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
