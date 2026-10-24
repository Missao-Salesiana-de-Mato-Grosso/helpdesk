import { InMemoryWebStorage, WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

export const CALLBACK_PATH = '/auth/callback';

/** Estado levado pelo redirect de login: para onde voltar depois do callback. */
export interface SigninState {
  returnTo: string;
}

export function isSigninState(value: unknown): value is SigninState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'returnTo' in value &&
    typeof value.returnTo === 'string'
  );
}

export interface OidcEnv {
  authority: string;
  clientId: string;
  projectId: string;
}

/** Lê as variáveis VITE_ZITADEL_*. Devolve a lista das que faltam, se houver. */
export function readOidcEnv(
  env: Record<string, string | undefined>,
): OidcEnv | { missing: string[] } {
  const authority = env['VITE_ZITADEL_AUTHORITY'];
  const clientId = env['VITE_ZITADEL_CLIENT_ID'];
  const projectId = env['VITE_ZITADEL_PROJECT_ID'];
  if (authority && clientId && projectId) return { authority, clientId, projectId };
  const entries: [string, string | undefined][] = [
    ['VITE_ZITADEL_AUTHORITY', authority],
    ['VITE_ZITADEL_CLIENT_ID', clientId],
    ['VITE_ZITADEL_PROJECT_ID', projectId],
  ];
  const missing = entries.filter(([, value]) => !value).map(([key]) => key);
  return { missing };
}

/** Configuração do oidc-client-ts (spec T04–T05 §11): Authorization Code + PKCE, tokens só em memória. */
export function buildOidcSettings(env: OidcEnv, origin: string): UserManagerSettings {
  return {
    authority: env.authority,
    client_id: env.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: 'code',
    scope: [
      'openid',
      'profile',
      'email',
      'offline_access',
      `urn:zitadel:iam:org:project:id:${env.projectId}:aud`,
      'urn:zitadel:iam:org:projects:roles',
      'urn:zitadel:iam:user:resourceowner',
    ].join(' '),
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  };
}
