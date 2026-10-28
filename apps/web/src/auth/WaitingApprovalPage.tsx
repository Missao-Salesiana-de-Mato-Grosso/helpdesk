import { Anchor, Button, Text } from '@mantine/core';
import { useAuth } from 'react-oidc-context';
import { Navigate } from 'react-router';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { homePath } from '../layout/navigation.ts';
import { ACCESS_REJECTED_PATH } from './RequireAuth.tsx';
import { useMe } from './useMe.ts';

const SUPPORT_EMAIL = 'suporte@missaosalesiana.org.br';
/** T22 §8: a tela consulta `GET /me` a cada 60 s para entrar sozinha quando o admin aprovar. */
const POLL_INTERVAL_MS = 60_000;

/** T22 RN-05/RN-08: usuário com `accessStatus === 'pending'`. */
export function WaitingApprovalPage() {
  const auth = useAuth();
  const { data: me } = useMe(true, { refetchInterval: POLL_INTERVAL_MS });

  if (me && me.accessStatus === 'rejected') {
    return <Navigate to={ACCESS_REJECTED_PATH} replace />;
  }
  if (me && me.accessStatus !== 'pending') {
    return <Navigate to={homePath(me.isAgent)} replace />;
  }

  return (
    <StatusScreen
      title="Aguardando liberação"
      actions={<Button onClick={() => void auth.signoutRedirect()}>Sair</Button>}
    >
      <Text>
        {me ? `Olá, ${me.name.split(' ')[0]}! ` : ''}Seu cadastro foi recebido
        {me?.company
          ? ` (${me.company.name}${me.department ? ` · ${me.department.name}` : ''})`
          : ''}
        . O suporte precisa liberar seu acesso antes de você entrar no portal.
      </Text>
      <Text size="sm" c="dimmed">
        Essa tela atualiza sozinha. Em caso de urgência, escreva para{' '}
        <Anchor href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Anchor>.
      </Text>
    </StatusScreen>
  );
}
