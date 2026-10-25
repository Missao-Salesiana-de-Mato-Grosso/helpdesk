import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  Typography,
} from '@mantine/core';
import { ApiErrorCode, type TicketDetail, type TicketMessage } from '@helpdesk/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiRequestError } from '../../api/client.ts';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { formatDateTime } from './format.ts';
import { useReply, useTicket } from './queries.ts';

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
  return (
    <Paper withBorder p="md" bg={message.kind === 'internal' ? 'yellow.0' : undefined}>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={600}>{message.author.name}</Text>
          {message.author.isAgent && (
            <Badge size="sm" variant="light">
              Suporte
            </Badge>
          )}
          {message.kind === 'internal' && (
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
      {message.quotedHtml && (
        <Stack gap="xs" mt="xs" align="flex-start">
          <Button variant="subtle" size="compact-sm" onClick={() => setShowQuoted((v) => !v)}>
            {showQuoted ? 'Ocultar texto citado' : 'Mostrar texto citado'}
          </Button>
          {showQuoted && (
            <Text component="div" c="dimmed" data-testid="quoted">
              <MessageHtml html={message.quotedHtml} />
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  );
}

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
export function TicketDetailPage() {
  const { id } = useParams();
  const ticket = useTicket(id);

  if (ticket.isPending) return <Loader aria-label="Carregando" />;
  if (ticket.error) {
    const notFound =
      ticket.error instanceof ApiRequestError && ticket.error.code === ApiErrorCode.NOT_FOUND;
    return (
      <StatusScreen
        title={notFound ? 'Chamado não encontrado' : 'Não foi possível carregar o chamado'}
        actions={
          <Button component={Link} to="/tickets" variant="light">
            Voltar para meus tickets
          </Button>
        }
      >
        {notFound ? 'Ele não existe ou você não tem acesso a ele.' : ticket.error.message}
      </StatusScreen>
    );
  }

  const data = ticket.data;
  return (
    <Stack maw={860}>
      <div>
        <Group gap="sm">
          <Title order={1} size="h2">
            #{data.number} · {data.subject}
          </Title>
          <StatusBadge status={data.status} />
        </Group>
        <Text size="sm" c="dimmed" mt={4}>
          {data.category.name} · {data.company?.name ?? 'Sem unidade'} · aberto em{' '}
          {formatDateTime(data.createdAt)}
        </Text>
      </div>

      <Stack gap="sm" aria-label="Conversa">
        {data.messages.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
      </Stack>

      <ReplyForm ticket={data} />
    </Stack>
  );
}
