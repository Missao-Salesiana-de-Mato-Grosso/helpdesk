import { useCallback, useMemo, type ReactNode } from 'react';
import { AuthProvider } from 'react-oidc-context';
import type { User } from 'oidc-client-ts';
import { useNavigate } from 'react-router';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { buildOidcSettings, CALLBACK_PATH, isSigninState, readOidcEnv } from './oidc-config.ts';

/** AuthProvider do react-oidc-context com a configuração da spec. Fica dentro do Router. */
export function OidcProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const env = useMemo(() => readOidcEnv(import.meta.env), []);
  const settings = useMemo(
    () => ('missing' in env ? null : buildOidcSettings(env, window.location.origin)),
    [env],
  );

  // Depois de trocar o code pelos tokens: tira code/state da URL e volta para onde o usuário estava.
  const onSigninCallback = useCallback(
    (user: User | undefined) => {
      const returnTo = isSigninState(user?.state) ? user.state.returnTo : '/';
      void navigate(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', {
        replace: true,
      });
    },
    [navigate],
  );

  if ('missing' in env || !settings) {
    return (
      <StatusScreen title="Configuração incompleta">
        <p>Faltam variáveis no .env: {'missing' in env ? env.missing.join(', ') : ''}.</p>
        <p>
          Rode <code>pnpm infra:bootstrap</code> e reinicie o <code>pnpm dev</code>.
        </p>
      </StatusScreen>
    );
  }

  return (
    <AuthProvider
      {...settings}
      onSigninCallback={onSigninCallback}
      skipSigninCallback={window.location.pathname !== CALLBACK_PATH}
    >
      {children}
    </AuthProvider>
  );
}
