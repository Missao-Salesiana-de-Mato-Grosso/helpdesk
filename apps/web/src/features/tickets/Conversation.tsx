import { Badge, Button, Group, Paper, Stack, Text, Title, Typography } from '@mantine/core';
import type { TicketDetail, TicketMessage } from '@helpdesk/shared';
import { useState } from 'react';
import { AttachmentList } from '../attachments/AttachmentList.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { formatDateTime } from './format.ts';

/**
 * HTML que a API devolve. O backend sanitiza todo corpo antes de gravar (sanitize-html com
 * allowlist), e o deploy aplica CSP restritiva (T17).
 */
function MessageHtml({ html }: { html: string }) {
  // oxlint-disable-next-line react/no-danger -- HTML já sanitizado no backend antes de gravar.
  return <Typography dangerouslySetInnerHTML={{ __html: html }} />;
}

function MessageCard({ message }: { message: TicketMessage }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const internal = message.kind === 'internal';
  return (
    <Paper withBorder p="md" bg={internal ? 'yellow.0' : undefined}>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={600}>{message.author.name}</Text>
          {message.author.isAgent && (
            <Badge size="sm" variant="light">
              Suporte
            </Badge>
          )}
          {internal && (
            <Badge size="sm" color="yellow">
              Nota interna
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {formatDateTime(message.createdAt)}
        </Text>
      </Group>
      <MessageHtml html={message.bodyHtml} />
      <AttachmentList attachments={message.attachments} />
      {message.quotedHtml && (
        <Stack gap="xs" mt="xs" align="flex-start">
          <Button variant="subtle" size="compact-sm" onClick={() => setShowQuoted((v) => !v)}>
            {showQuoted ? 'Ocultar texto citado' : 'Mostrar texto citado'}
          </Button>
          {showQuoted && (
            <Text component="div" c="dimmed">
              <MessageHtml html={message.quotedHtml} />
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  );
}

export function Conversation({ messages }: { messages: TicketMessage[] }) {
  return (
    <Stack gap="sm" aria-label="Conversa">
      {messages.map((message) => (
        <MessageCard key={message.id} message={message} />
      ))}
    </Stack>
  );
}

export function TicketHeader({ ticket }: { ticket: TicketDetail }) {
  return (
    <div>
      <Group gap="sm">
        <Title order={1} size="h2">
          #{ticket.number} · {ticket.subject}
        </Title>
        <StatusBadge status={ticket.status} />
      </Group>
      <Text size="sm" c="dimmed" mt={4}>
        {ticket.category.name} · {ticket.company?.name ?? 'Sem unidade'} · aberto em{' '}
        {formatDateTime(ticket.createdAt)}
      </Text>
    </div>
  );
}
