import { useAuth } from 'react-oidc-context';
import { StatusScreen } from './StatusScreen.tsx';

/** `/auth/callback`: o AuthProvider troca o code pelos tokens e o `onSigninCallback` navega de volta. */
export function AuthCallback() {
  const auth = useAuth();
  if (auth.error) {
    return (
      <StatusScreen
        title="Não foi possível entrar"
        actions={<button onClick={() => void auth.signinRedirect()}>Tentar de novo</button>}
      >
        <p>{auth.error.message}</p>
      </StatusScreen>
    );
  }
  return <StatusScreen title="Entrando…" />;
}
