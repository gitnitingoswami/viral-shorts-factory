import { validateEnv } from './env.schema';

const base = {
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
  STORAGE_BUCKET: 'bucket',
  STORAGE_ACCESS_KEY: 'a',
  STORAGE_SECRET_KEY: 's',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
};

describe('validateEnv', () => {
  it('applies defaults and parses booleans', () => {
    const env = validateEnv({ ...base, COOKIE_SECURE: 'false', SWAGGER_ENABLED: 'true' });
    expect(env.PORT).toBe(3100);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects a short JWT secret without echoing its value', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'tooshort-secret' })).toThrow(/JWT_ACCESS_SECRET/);
    try {
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'tooshort-secret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('tooshort-secret');
    }
  });

  it('rejects the .env.example placeholder secret', () => {
    expect(() =>
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters' }),
    ).toThrow(/placeholder/);
  });

  it('requires secure cookies in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
  });

  it('requires bootstrap email and password together', () => {
    expect(() => validateEnv({ ...base, BOOTSTRAP_OWNER_EMAIL: 'a@b.co' })).toThrow(/together/);
    expect(() => validateEnv({ ...base, BOOTSTRAP_OWNER_EMAIL: 'a@b.co', BOOTSTRAP_OWNER_PASSWORD: 'short' })).toThrow();
    expect(validateEnv({ ...base, BOOTSTRAP_OWNER_EMAIL: '', BOOTSTRAP_OWNER_PASSWORD: '' }).BOOTSTRAP_OWNER_EMAIL).toBe('');
  });

  it('rejects missing required DB settings', () => {
    const { DB_PASSWORD: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DB_PASSWORD/);
  });

  it('rejects an invalid boolean', () => {
    expect(() => validateEnv({ ...base, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });
});
