import { Anchor, Button, Text } from '@mantine/core';
import { useAuth } from 'react-oidc-context';
import { StatusScreen } from '../components/StatusScreen.tsx';

const SUPPORT_EMAIL = 'suporte@missaosalesiana.org.br';

/**
 * T22 RN-08: `accessStatus === 'rejected'`. Texto fixo, sem o motivo interno da recusa
 * (`access_note` nunca sai da API). Sem polling: a recusa não muda sozinha.
 */
export function AccessRejectedPage() {
  const auth = useAuth();
  return (
    <StatusScreen
      title="Acesso não liberado"
      actions={<Button onClick={() => void auth.signoutRedirect()}>Sair</Button>}
    >
      <Text>Seu acesso ao help desk não foi liberado pelo suporte.</Text>
      <Text size="sm" c="dimmed">
        Se acha que isso é um engano, escreva para{' '}
        <Anchor href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Anchor>.
      </Text>
    </StatusScreen>
  );
}
