import { Button } from '@mantine/core';
import { useAuth } from 'react-oidc-context';
import { StatusScreen } from '../components/StatusScreen.tsx';

/** `/auth/callback`: o AuthProvider troca o code pelos tokens e o `onSigninCallback` navega de volta. */
export function AuthCallback() {
  const auth = useAuth();
  if (auth.error) {
    return (
      <StatusScreen
        title="Não foi possível entrar"
        actions={<Button onClick={() => void auth.signinRedirect()}>Tentar de novo</Button>}
      >
        <p>{auth.error.message}</p>
      </StatusScreen>
    );
  }
  return <StatusScreen title="Entrando…" />;
}
