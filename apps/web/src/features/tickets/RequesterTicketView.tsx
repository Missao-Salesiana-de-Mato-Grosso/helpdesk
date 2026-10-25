import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import type { TicketDetail } from '@helpdesk/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import { Conversation, TicketHeader } from './Conversation.tsx';
import { useReply } from './queries.ts';

function ReplyForm({ ticket }: { ticket: TicketDetail }) {
  const reply = useReply(ticket.id);
  const [bodyHtml, setBodyHtml] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (ticket.status === 'closed') {
    return (
      <Alert color="gray" title="Este chamado está fechado">
        <Stack align="flex-start" gap="sm">
          <Text size="sm">Ele não recebe mais respostas. Se precisar, abra um novo chamado.</Text>
          <Button component={Link} to={`/tickets/novo?relacionado=${ticket.id}`} variant="light">
            Abrir novo chamado relacionado
          </Button>
        </Stack>
      </Alert>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (bodyHtml === '') return;
    reply.mutate(
      { kind: 'public', bodyHtml },
      {
        onSuccess: () => {
          setBodyHtml('');
          setSubmitted(false);
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        {ticket.status === 'resolved' && (
          <Alert color="green" title="Este chamado foi resolvido">
            Se o problema continua, responda abaixo e ele será reaberto.
          </Alert>
        )}
        <HtmlEditor
          label="Sua resposta"
          value={bodyHtml}
          onChange={setBodyHtml}
          error={submitted && bodyHtml === '' ? 'Escreva a mensagem' : undefined}
          disabled={reply.isPending}
        />
        {reply.error && (
          <Alert color="red" title="Não foi possível enviar a resposta">
            {reply.error.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={reply.isPending}>
            Enviar resposta
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Detalhe do chamado para o solicitante (T11). */
export function RequesterTicketView({ ticket }: { ticket: TicketDetail }) {
  return (
    <Stack maw={860}>
      <TicketHeader ticket={ticket} />
      <Conversation messages={ticket.messages} />
      <ReplyForm ticket={ticket} />
    </Stack>
  );
}
