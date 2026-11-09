import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { slaState, type SlaTarget, type TicketSla } from '@helpdesk/shared';
import { formatDateTime } from './format.ts';
import { SLA_COLOR, currentTarget, slaText, useNow } from './sla-text.ts';

function TargetBadge({ target, pausedAt }: { target: SlaTarget; pausedAt: string | null }) {
  const now = useNow();
  const state = slaState(target, pausedAt, now);
  return (
    <Badge color={SLA_COLOR[state]} variant="light">
      {slaText(state, target, pausedAt, now)}
    </Badge>
  );
}

/** T28: coluna "Prazo" da fila. */
export function SlaBadge({ sla }: { sla: TicketSla | null }) {
  const current = sla && currentTarget(sla);
  if (!sla || !current) return <Text c="dimmed">—</Text>;
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {current.label}
      </Text>
      <TargetBadge target={current.target} pausedAt={sla.pausedAt} />
    </Stack>
  );
}

/** T28: as duas metas no painel do ticket. */
export function SlaPanel({ sla }: { sla: TicketSla }) {
  const rows = [
    { label: '1ª resposta', target: sla.firstResponse },
    { label: 'Resolução', target: sla.resolution },
  ];
  if (rows.every((row) => row.target === null)) return null;
  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          SLA
        </Text>
        {rows.map(
          ({ label, target }) =>
            target && (
              <Group key={label} justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm">{label}</Text>
                  <Text size="xs" c="dimmed">
                    Prazo {formatDateTime(target.dueAt)}
                  </Text>
                </div>
                <TargetBadge target={target} pausedAt={sla.pausedAt} />
              </Group>
            ),
        )}
      </Stack>
    </Paper>
  );
}
