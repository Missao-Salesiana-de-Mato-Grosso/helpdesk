import { Paper, Stack, Text } from '@mantine/core';
import { SATISFACTION_LABELS, type TicketSatisfaction } from '@helpdesk/shared';
import { formatDateTime } from '../tickets/format.ts';

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Cuiaba',
});

/**
 * T40 RN-17: a avaliação do solicitante no painel do chamado. Só aparece para supervisor e admin
 * (a API só manda `satisfaction` para eles, RN-16).
 */
export function SatisfactionPanel({ satisfaction }: { satisfaction: TicketSatisfaction | null }) {
  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Avaliação do solicitante
        </Text>
        <SatisfactionText satisfaction={satisfaction} />
      </Stack>
    </Paper>
  );
}

function SatisfactionText({ satisfaction }: { satisfaction: TicketSatisfaction | null }) {
  if (satisfaction?.score) {
    return (
      <>
        <Text size="sm">
          {satisfaction.score} — {SATISFACTION_LABELS[satisfaction.score]}
        </Text>
        {satisfaction.comment && (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {satisfaction.comment}
          </Text>
        )}
        {satisfaction.ratedAt && (
          <Text size="xs" c="dimmed">
            Avaliado em {formatDateTime(satisfaction.ratedAt)}
          </Text>
        )}
      </>
    );
  }
  if (satisfaction?.linkActive) {
    return (
      <Text size="sm" c="dimmed">
        Aguardando avaliação (link enviado em {DAY_MONTH.format(new Date(satisfaction.requestedAt))}
        )
      </Text>
    );
  }
  return (
    <Text size="sm" c="dimmed">
      Sem avaliação
    </Text>
  );
}
