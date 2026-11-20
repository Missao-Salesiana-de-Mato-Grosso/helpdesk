import { Badge, Group, Mark, Text } from '@mantine/core';
import type { TicketMatch } from '@helpdesk/shared';
import { splitSnippet } from './match-snippet.ts';

/** Spec T38 RN-08 e RN-11: onde a busca achou o termo, abaixo do assunto na lista. */
export function MatchSnippet({ match }: { match: TicketMatch }) {
  return (
    <Group gap={6} wrap="nowrap" align="flex-start" mt={2}>
      {match.source === 'internal' && (
        <Badge size="xs" color="yellow" variant="light">
          Nota interna
        </Badge>
      )}
      <Text size="xs" c="dimmed" lineClamp={2} data-testid="match-snippet">
        {splitSnippet(match.snippet).map((part, index) =>
          part.hit ? <Mark key={index}>{part.text}</Mark> : <span key={index}>{part.text}</span>,
        )}
      </Text>
    </Group>
  );
}
