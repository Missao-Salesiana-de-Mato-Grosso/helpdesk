import { ApiErrorCode } from '@helpdesk/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Navigate, useLocation } from 'react-router';
import { ApiRequestError } from '../api/client.ts';
import type { SigninState } from './oidc-config.ts';
import { StatusScreen } from './StatusScreen.tsx';
import { useMe } from './useMe.ts';

export const ONBOARDING_PATH = '/primeiro-acesso';

const REAUTH_KEY = 'helpdesk:reauth-at';
const REAUTH_WINDOW_MS = 30_000;

/**
 * Trava contra loop: se a API recusar o token logo depois de um login novo (ex.: `aud` errado),
 * redirecionar de novo não resolve. A hora do último redirect por 401 fica na sessionStorage.
 */
function reauthenticatedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(REAUTH_KEY) ?? 0) < REAUTH_WINDOW_MS;
  } catch {
    return false; // sessionStorage indisponível: segue sem a trava.
  }
}

function markReauthentication(): void {
  try {
    sessionStorage.setItem(REAUTH_KEY, String(Date.now()));
  } catch {
    // idem
  }
}

/** Erros em que logar de novo não resolve: só resta mostrar a mensagem e sair (spec §11). */
const NO_ACCESS_CODES = new Set<string>([
  ApiErrorCode.USER_INACTIVE,
  ApiErrorCode.EXTERNAL_USER_CANNOT_LOGIN,
  ApiErrorCode.WRONG_ORGANIZATION,
  ApiErrorCode.EMAIL_NOT_VERIFIED,
]);

/**
 * Exige login e carrega o `/me`. Sem sessão → redirect para o Zitadel, voltando para a rota atual.
 * `needsOnboarding` → tela de 1º acesso (exceto na própria). Erros de acesso → tela "sem acesso".
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const authenticated = auth.isAuthenticated;
  const me = useMe(authenticated);
  const meError = me.error instanceof ApiRequestError ? me.error : null;
  const unauthorized = meError?.statusCode === 401;
  const noSession = !auth.isLoading && !authenticated && !auth.activeNavigator && !auth.error;
  // Decidido uma vez por erro: gravar a hora no effect não muda a decisão deste erro.
  const reauthBlocked = useMemo(
    () => meError?.statusCode === 401 && reauthenticatedRecently(),
    [meError],
  );
  const mustSignIn = noSession || (unauthorized && !reauthBlocked);

  useEffect(() => {
    if (!mustSignIn) return;
    if (unauthorized) markReauthentication();
    void auth.signinRedirect({ state: { returnTo } satisfies SigninState });
  }, [mustSignIn, unauthorized, auth, returnTo]);

  if (auth.error) {
    return (
      <StatusScreen
        title="Não foi possível entrar"
        actions={
          <button onClick={() => void auth.signinRedirect({ state: { returnTo } })}>
            Tentar de novo
          </button>
        }
      >
        <p>{auth.error.message}</p>
      </StatusScreen>
    );
  }

  if (mustSignIn || auth.isLoading || !authenticated || me.isPending) {
    return <StatusScreen title="Entrando…" />;
  }

  if (meError && NO_ACCESS_CODES.has(meError.code)) {
    return (
      <StatusScreen
        title="Sem acesso"
        actions={<button onClick={() => void auth.signoutRedirect()}>Sair</button>}
      >
        <p>{meError.message}</p>
      </StatusScreen>
    );
  }

  if (reauthBlocked) {
    return (
      <StatusScreen
        title="Não foi possível entrar"
        actions={<button onClick={() => void auth.signoutRedirect()}>Sair</button>}
      >
        <p>O servidor recusou sua sessão logo após o login. Avise o suporte de TI.</p>
      </StatusScreen>
    );
  }

  if (me.isError || !me.data) {
    const unavailable = meError?.code === ApiErrorCode.AUTH_UNAVAILABLE;
    return (
      <StatusScreen
        title={unavailable ? 'Autenticação temporariamente indisponível' : 'Algo deu errado'}
        actions={<button onClick={() => void me.refetch()}>Tentar de novo</button>}
      >
        <p>{me.error?.message ?? 'Não foi possível carregar seus dados.'}</p>
      </StatusScreen>
    );
  }

  if (me.data.needsOnboarding && location.pathname !== ONBOARDING_PATH) {
    return <Navigate to={ONBOARDING_PATH} replace />;
  }

  return <>{children}</>;
}
