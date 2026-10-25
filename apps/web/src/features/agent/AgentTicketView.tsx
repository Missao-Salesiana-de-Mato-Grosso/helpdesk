import { Alert, Grid, Stack, Tabs } from '@mantine/core';
import { ApiErrorCode, type MeResponse, type TicketDetail } from '@helpdesk/shared';
import { useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { Conversation, TicketHeader } from '../tickets/Conversation.tsx';
import { useUpdateTicket } from '../tickets/queries.ts';
import { AgentComposer } from './AgentComposer.tsx';
import { TicketHistory } from './TicketHistory.tsx';
import { TicketSidePanel, type TicketChanges } from './TicketSidePanel.tsx';

export const CONFLICT_MESSAGE =
  'Este chamado foi alterado por outra pessoa. Carregamos a versão atual; revise e tente de novo.';
const COMPANY_REQUIRED_MESSAGE = 'Defina a unidade antes de resolver ou fechar o chamado.';

/** Detalhe do chamado para o agente (T12): conversa, resposta/nota, histórico e painel lateral. */
export function AgentTicketView({ ticket, me }: { ticket: TicketDetail; me: MeResponse }) {
  const update = useUpdateTicket(ticket.id);
  const companyRef = useRef<HTMLInputElement>(null);
  const [companyError, setCompanyError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [writeError, setWriteError] = useState<string>();

  const requireCompany = () => {
    setCompanyError(COMPANY_REQUIRED_MESSAGE);
    companyRef.current?.focus();
  };

  const onWriteError = (error: Error) => {
    if (error instanceof ApiRequestError && error.code === ApiErrorCode.VERSION_CONFLICT) {
      setConflict(true);
    } else if (error instanceof ApiRequestError && error.code === ApiErrorCode.COMPANY_REQUIRED) {
      requireCompany();
    } else {
      setWriteError(error.message);
    }
  };

  const change = (changes: TicketChanges) => {
    setConflict(false);
    setWriteError(undefined);
    if (changes.companyId) setCompanyError(undefined);
    update.mutate({ version: ticket.version, ...changes }, { onError: onWriteError });
  };

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 8 }}>
        <Stack>
          <TicketHeader ticket={ticket} />
          {conflict && (
            <Alert
              color="orange"
              title="Chamado atualizado"
              withCloseButton
              closeButtonLabel="Fechar aviso"
              onClose={() => setConflict(false)}
            >
              {CONFLICT_MESSAGE}
            </Alert>
          )}
          {writeError && (
            <Alert
              color="red"
              title="Não foi possível salvar"
              withCloseButton
              closeButtonLabel="Fechar aviso"
              onClose={() => setWriteError(undefined)}
            >
              {writeError}
            </Alert>
          )}
          <Tabs defaultValue="conversation">
            <Tabs.List>
              <Tabs.Tab value="conversation">Conversa</Tabs.Tab>
              <Tabs.Tab value="history">Histórico</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="conversation" pt="md">
              <Stack>
                <Conversation messages={ticket.messages} />
                <AgentComposer
                  ticket={ticket}
                  onError={onWriteError}
                  onCompanyRequired={requireCompany}
                />
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="history" pt="md">
              <TicketHistory ticket={ticket} />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <TicketSidePanel
          ticket={ticket}
          me={me}
          onChange={change}
          onCompanyRequired={requireCompany}
          companyRef={companyRef}
          companyError={companyError}
          saving={update.isPending}
        />
      </Grid.Col>
    </Grid>
  );
}
