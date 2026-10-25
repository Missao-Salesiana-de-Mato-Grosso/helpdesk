import { ActionIcon, Alert, Button, Group, Menu, Stack, Tabs } from '@mantine/core';
import type { CreateMessageInput, TicketDetail, TicketStatus } from '@helpdesk/shared';
import { useState } from 'react';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import { STATUS_LABEL } from '../tickets/format.ts';
import { useReply } from '../tickets/queries.ts';

const SEND_AND: readonly TicketStatus[] = ['pending', 'resolved'];

export interface AgentComposerProps {
  ticket: TicketDetail;
  onError: (error: Error) => void;
  onCompanyRequired: () => void;
}

/** Abas "Resposta" e "Nota interna" (T12). Cada aba guarda o próprio rascunho. */
export function AgentComposer({ ticket, onError, onCompanyRequired }: AgentComposerProps) {
  const send = useReply(ticket.id);
  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [replyHtml, setReplyHtml] = useState('');
  const [noteHtml, setNoteHtml] = useState('');
  const [emptyTab, setEmptyTab] = useState<'reply' | 'note' | null>(null);

  if (ticket.status === 'closed') {
    return (
      <Alert color="gray" title="Este chamado está fechado">
        Ele não recebe mais respostas nem notas.
      </Alert>
    );
  }

  const submit = (kind: 'public' | 'internal', status?: TicketStatus) => {
    const bodyHtml = kind === 'public' ? replyHtml : noteHtml;
    const which = kind === 'public' ? 'reply' : 'note';
    if (bodyHtml === '') {
      setEmptyTab(which);
      return;
    }
    if (status === 'resolved' && ticket.company === null) {
      onCompanyRequired();
      return;
    }
    setEmptyTab(null);
    const body: CreateMessageInput = status
      ? { kind, bodyHtml, status, version: ticket.version }
      : { kind, bodyHtml };
    send.mutate(body, {
      onSuccess: () => (kind === 'public' ? setReplyHtml('') : setNoteHtml('')),
      onError,
    });
  };

  const emptyError = (which: 'reply' | 'note') =>
    emptyTab === which ? 'Escreva a mensagem' : undefined;

  return (
    <Tabs value={tab} onChange={(value) => setTab(value === 'note' ? 'note' : 'reply')}>
      <Tabs.List>
        <Tabs.Tab value="reply">Resposta</Tabs.Tab>
        <Tabs.Tab value="note">Nota interna</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="reply" pt="sm">
        <Stack>
          <HtmlEditor
            label="Resposta ao solicitante"
            value={replyHtml}
            onChange={setReplyHtml}
            error={emptyError('reply')}
            disabled={send.isPending}
          />
          <Group justify="flex-end" gap={4}>
            <Button onClick={() => submit('public')} loading={send.isPending}>
              Enviar
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon
                  size="lg"
                  variant="filled"
                  aria-label="Enviar e mudar a situação"
                  disabled={send.isPending}
                >
                  ▾
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {SEND_AND.filter((status) => status !== ticket.status).map((status) => (
                  <Menu.Item key={status} onClick={() => submit('public', status)}>
                    Enviar e marcar como {STATUS_LABEL[status]}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel value="note" pt="sm">
        <Stack>
          <HtmlEditor
            label="Nota interna (só a equipe vê)"
            value={noteHtml}
            onChange={setNoteHtml}
            error={emptyError('note')}
            disabled={send.isPending}
          />
          <Group justify="flex-end">
            <Button color="yellow" onClick={() => submit('internal')} loading={send.isPending}>
              Salvar nota
            </Button>
          </Group>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}
