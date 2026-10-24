import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5434/db',
  ZITADEL_ISSUER: 'http://localhost:8080',
  ZITADEL_PROJECT_ID: '123',
};

describe('validateEnv', () => {
  it('applies defaults and coerces PORT', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.AUTH_CLOCK_TOLERANCE_SECONDS).toBe(60);
    expect(env.AUTH_CACHE_TTL_SECONDS).toBe(60);
  });

  it('rejects a missing DATABASE_URL with a readable message', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not postgresql', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/);
  });

  it('requires ZITADEL_PROJECT_ID', () => {
    expect(() => validateEnv({ ...base, ZITADEL_PROJECT_ID: '' })).toThrow(/ZITADEL_PROJECT_ID/);
  });

  it('strips the trailing slash from ZITADEL_ISSUER and treats an empty ZITADEL_ORG_ID as unset', () => {
    const env = validateEnv({
      ...base,
      ZITADEL_ISSUER: 'https://auth.msmt.org.br/',
      ZITADEL_ORG_ID: '',
    });
    expect(env.ZITADEL_ISSUER).toBe('https://auth.msmt.org.br');
    expect(env.ZITADEL_ORG_ID).toBeUndefined();
  });
});
