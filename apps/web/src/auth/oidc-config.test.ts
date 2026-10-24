import { describe, expect, it } from 'vitest';
import { buildOidcSettings, isSigninState, readOidcEnv } from './oidc-config.ts';

describe('readOidcEnv', () => {
  it('lista as variáveis que faltam', () => {
    expect(readOidcEnv({ VITE_ZITADEL_AUTHORITY: 'http://localhost:8080' })).toEqual({
      missing: ['VITE_ZITADEL_CLIENT_ID', 'VITE_ZITADEL_PROJECT_ID'],
    });
  });
});

describe('buildOidcSettings', () => {
  const settings = buildOidcSettings(
    { authority: 'http://localhost:8080', clientId: 'client-1', projectId: 'proj-1' },
    'http://localhost:5173',
  );

  it('usa code + PKCE, callback e logout na origem do app', () => {
    expect(settings.response_type).toBe('code');
    expect(settings.redirect_uri).toBe('http://localhost:5173/auth/callback');
    expect(settings.post_logout_redirect_uri).toBe('http://localhost:5173/');
    expect(settings.automaticSilentRenew).toBe(true);
  });

  it('pede os escopos do Zitadel da spec §11 (aud do projeto, roles, org)', () => {
    expect(settings.scope?.split(' ')).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'urn:zitadel:iam:org:project:id:proj-1:aud',
      'urn:zitadel:iam:org:projects:roles',
      'urn:zitadel:iam:user:resourceowner',
    ]);
  });
});

describe('isSigninState', () => {
  it('aceita { returnTo: string } e recusa o resto', () => {
    expect(isSigninState({ returnTo: '/x' })).toBe(true);
    expect(isSigninState(undefined)).toBe(false);
    expect(isSigninState({ returnTo: 1 })).toBe(false);
  });
});
