import { Badge, Button, Group, Paper, Stack, Text, Title, Typography } from '@mantine/core';
import type { TicketDetail, TicketMessage } from '@helpdesk/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../../api/api-context.ts';
import { AttachmentList } from '../attachments/AttachmentList.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { formatDateTime } from './format.ts';

/**
 * T32 RN-11 e RN-13: cada `<img data-attachment-id>` é baixada com o token (um `src` direto não
 * leva o Bearer) e exibida por `blob:`. Até carregar fica o texto alternativo; se falhar, ele
 * substitui a imagem.
 */
function useInlineImages(root: HTMLDivElement | null, html: string) {
  const api = useApi();
  useEffect(() => {
    const images = root?.querySelectorAll<HTMLImageElement>('img[data-attachment-id]');
    let cancelled = false;
    const urls: string[] = [];
    for (const img of images ?? []) {
      img.alt ||= 'imagem';
      img.style.maxWidth = '100%';
      const id = img.dataset['attachmentId']!;
      api<Blob>(`/attachments/${id}`, { responseType: 'blob' }).then(
        (blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          img.src = url;
        },
        () => {
          if (!cancelled) img.replaceWith(document.createTextNode(`[${img.alt}]`));
        },
      );
    }
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // `html` não é lido aqui, mas quando muda o React troca o conteúdo do elemento: busca de novo.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, root, html]);
}

/**
 * HTML que a API devolve. O backend sanitiza todo corpo antes de gravar (sanitize-html com
 * allowlist), e o deploy aplica CSP restritiva (T17).
 */
function MessageHtml({ html }: { html: string }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useInlineImages(root, html);
  // oxlint-disable-next-line react/no-danger -- HTML já sanitizado no backend antes de gravar.
  return <Typography ref={setRoot} dangerouslySetInnerHTML={{ __html: html }} />;
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
      {/* T32 RN-12: as imagens do texto já aparecem no corpo. */}
      <AttachmentList attachments={message.attachments.filter((a) => !a.inline)} />
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
