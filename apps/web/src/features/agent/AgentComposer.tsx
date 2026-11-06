import { ActionIcon, Alert, Button, Group, Menu, Stack, Tabs } from '@mantine/core';
import {
  firstName,
  type CannedVariables,
  type CreateMessageInput,
  type TicketDetail,
  type TicketStatus,
} from '@helpdesk/shared';
import { useRef, useState } from 'react';
import { useMe } from '../../auth/useMe.ts';
import { HtmlEditor, type HtmlEditorHandle } from '../../components/HtmlEditor.tsx';
import { AttachmentPicker } from '../attachments/AttachmentPicker.tsx';
import { CannedResponsePicker } from '../canned-responses/CannedResponsePicker.tsx';
import { STATUS_LABEL } from '../tickets/format.ts';
import { useReply } from '../tickets/queries.ts';

const SEND_AND: readonly TicketStatus[] = ['pending', 'resolved'];

export interface AgentComposerProps {
  ticket: TicketDetail;
  onError: (error: Error) => void;
  onCompanyRequired: () => void;
}

/**
 * Abas "Resposta" e "Nota interna" (T12). Cada aba guarda o próprio rascunho e aceita respostas
 * prontas (T26), inseridas na posição do cursor.
 */
export function AgentComposer({ ticket, onError, onCompanyRequired }: AgentComposerProps) {
  const send = useReply(ticket.id);
  const { data: me } = useMe();
  const replyEditor = useRef<HtmlEditorHandle>(null);
  const noteEditor = useRef<HtmlEditorHandle>(null);
  const variables: CannedVariables = {
    solicitante: firstName(ticket.requester.name),
    numero: `#${ticket.number}`,
    agente: firstName(me?.name ?? ''),
  };
  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [replyHtml, setReplyHtml] = useState('');
  const [noteHtml, setNoteHtml] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
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
    send.mutate(
      { data: body, files: kind === 'public' ? replyFiles : noteFiles },
      {
        onSuccess: () => {
          if (kind === 'public') {
            setReplyHtml('');
            setReplyFiles([]);
          } else {
            setNoteHtml('');
            setNoteFiles([]);
          }
        },
        onError,
      },
    );
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
          <CannedResponsePicker
            variables={variables}
            onPick={(html) => replyEditor.current?.insertHtml(html)}
            disabled={send.isPending}
          />
          <HtmlEditor
            label="Resposta ao solicitante"
            value={replyHtml}
            onChange={setReplyHtml}
            error={emptyError('reply')}
            disabled={send.isPending}
            handleRef={replyEditor}
          />
          <AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={send.isPending} />
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
          <CannedResponsePicker
            variables={variables}
            onPick={(html) => noteEditor.current?.insertHtml(html)}
            disabled={send.isPending}
          />
          <HtmlEditor
            label="Nota interna (só a equipe vê)"
            value={noteHtml}
            onChange={setNoteHtml}
            error={emptyError('note')}
            disabled={send.isPending}
            handleRef={noteEditor}
          />
          <AttachmentPicker files={noteFiles} onChange={setNoteFiles} disabled={send.isPending} />
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
