import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies defaults and coerces PORT', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5434/db', PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects a missing DATABASE_URL with a readable message', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not postgresql', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/);
  });
});
