import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

const valid = {
  DATABASE_URL: 'postgres://gym_app:pw@localhost:5433/gym',
  DATABASE_MIGRATOR_URL: 'postgres://gym_owner:pw@localhost:5433/gym',
  DATABASE_SYSTEM_URL: 'postgres://gym_system:pw@localhost:5433/gym',
  JWT_SECRET: 'x'.repeat(32),
  WEB_ORIGIN: 'http://localhost:5173',
  SMTP_URL: 'smtp://localhost:1025',
  PLATFORM_ADMIN_EMAIL: 'admin@example.com',
  PLATFORM_ADMIN_PASSWORD: 'long-enough',
};

describe('loadEnv', () => {
  it('returns every key from a complete environment, with COOKIE_PATH defaulting to /auth', () => {
    expect(loadEnv(valid)).toEqual({ ...valid, COOKIE_PATH: '/auth' });
  });

  it('accepts a COOKIE_PATH for a deployment behind an /api prefix, and rejects a relative one', () => {
    expect(loadEnv({ ...valid, COOKIE_PATH: '/api/auth' }).COOKIE_PATH).toBe('/api/auth');
    expect(() => loadEnv({ ...valid, COOKIE_PATH: 'auth' })).toThrow('COOKIE_PATH');
  });

  it('normalises the platform admin email with trim and lowercase', () => {
    const env = loadEnv({ ...valid, PLATFORM_ADMIN_EMAIL: '  Admin@Example.COM ' });
    expect(env.PLATFORM_ADMIN_EMAIL).toBe('admin@example.com');
  });

  it.each(Object.keys(valid))('throws naming %s when it is missing', (key) => {
    const source: Record<string, string | undefined> = { ...valid, [key]: undefined };
    expect(() => loadEnv(source)).toThrow(key);
  });

  it('throws when JWT_SECRET is shorter than 32 characters (31 fails, 32 passes)', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'x'.repeat(31) })).toThrow('JWT_SECRET');
    expect(loadEnv({ ...valid, JWT_SECRET: 'x'.repeat(32) }).JWT_SECRET).toBe('x'.repeat(32));
  });

  it('throws when the platform admin password is shorter than 8 characters (7 fails, 8 passes)', () => {
    expect(() => loadEnv({ ...valid, PLATFORM_ADMIN_PASSWORD: 'seven77' })).toThrow(
      'PLATFORM_ADMIN_PASSWORD',
    );
    expect(loadEnv({ ...valid, PLATFORM_ADMIN_PASSWORD: 'eight888' }).PLATFORM_ADMIN_PASSWORD).toBe(
      'eight888',
    );
  });

  it.each(['', '   '])('treats %j as invalid for a required key', (blank) => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: blank })).toThrow('JWT_SECRET');
    expect(() => loadEnv({ ...valid, PLATFORM_ADMIN_EMAIL: blank })).toThrow(
      'PLATFORM_ADMIN_EMAIL',
    );
    expect(() => loadEnv({ ...valid, DATABASE_URL: blank })).toThrow('DATABASE_URL');
  });

  it.each([
    'DATABASE_URL',
    'DATABASE_SYSTEM_URL',
    'DATABASE_MIGRATOR_URL',
    'WEB_ORIGIN',
    'SMTP_URL',
  ])('throws when %s is not a URL', (key) => {
    expect(() => loadEnv({ ...valid, [key]: 'not a url' })).toThrow(key);
  });

  it('throws when the platform admin email is not an email, even after trimming', () => {
    expect(() => loadEnv({ ...valid, PLATFORM_ADMIN_EMAIL: '  not-an-email ' })).toThrow(
      'PLATFORM_ADMIN_EMAIL',
    );
  });

  it('reports every bad key at once, not just the first', () => {
    const run = () => loadEnv({ ...valid, JWT_SECRET: 'short', SMTP_URL: undefined });
    expect(run).toThrow('JWT_SECRET');
    expect(run).toThrow('SMTP_URL');
  });

  it('does not change other values while normalising the email', () => {
    const env = loadEnv({ ...valid, PLATFORM_ADMIN_EMAIL: '\tAdmin@Example.com\n' });
    expect(env).toEqual({
      ...valid,
      PLATFORM_ADMIN_EMAIL: 'admin@example.com',
      COOKIE_PATH: '/auth',
    });
  });
});
