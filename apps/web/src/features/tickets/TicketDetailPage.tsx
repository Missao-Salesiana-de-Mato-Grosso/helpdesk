import { Button, Loader } from '@mantine/core';
import { ApiErrorCode } from '@helpdesk/shared';
import { Link, useParams } from 'react-router';
import { ApiRequestError } from '../../api/client.ts';
import { useMe } from '../../auth/useMe.ts';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { AgentTicketView } from '../agent/AgentTicketView.tsx';
import { RequesterTicketView } from './RequesterTicketView.tsx';
import { useTicket } from './queries.ts';

/** `/tickets/:id`: visão do agente (T12) ou do solicitante (T11), conforme o papel. */
export function TicketDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const isAgent = me?.isAgent ?? false;
  const ticket = useTicket(id, { poll: isAgent });

  if (ticket.isPending) return <Loader aria-label="Carregando" />;
  if (ticket.error) {
    const notFound =
      ticket.error instanceof ApiRequestError && ticket.error.code === ApiErrorCode.NOT_FOUND;
    return (
      <StatusScreen
        title={notFound ? 'Chamado não encontrado' : 'Não foi possível carregar o chamado'}
        actions={
          <Button component={Link} to={isAgent ? '/fila' : '/tickets'} variant="light">
            {isAgent ? 'Voltar para a fila' : 'Voltar para meus tickets'}
          </Button>
        }
      >
        {notFound ? 'Ele não existe ou você não tem acesso a ele.' : ticket.error.message}
      </StatusScreen>
    );
  }

  return isAgent && me ? (
    <AgentTicketView ticket={ticket.data} me={me} />
  ) : (
    <RequesterTicketView ticket={ticket.data} />
  );
}
