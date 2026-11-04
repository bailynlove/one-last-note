import { describe, expect, it } from 'vitest';
import { ConfigError, parseServerConfig, parseWebConfig } from './index';

const required = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9090',
  S3_BUCKET: 'notes',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('server configuration', () => {
  it('applies development defaults', () => {
    const config = parseServerConfig(required);

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.WORKER_CONCURRENCY).toBe(5);
    expect(config.WEB_APP_URL).toBe('http://localhost:3000');
    expect(config.TRUST_PROXY_HOPS).toBe(0);
    expect(config.AUTH_EMAIL_FROM).toBe('One Last Note <login@one-last-note.dev>');
  });

  it('coerces and parses explicit values', () => {
    const config = parseServerConfig({
      ...required,
      PORT: '5000',
      S3_FORCE_PATH_STYLE: 'false',
      WORKER_CONCURRENCY: '12',
      LOG_LEVEL: 'debug',
    });

    expect(config.PORT).toBe(5000);
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
    expect(config.WORKER_CONCURRENCY).toBe(12);
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('rejects missing required values with a readable message', () => {
    expect(() => parseServerConfig({})).toThrow(ConfigError);
    expect(() => parseServerConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects half-configured Google sign-in', () => {
    expect(() => parseServerConfig({ ...required, GOOGLE_CLIENT_ID: 'client' })).toThrow(
      /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/,
    );
  });

  it('accepts a complete Google sign-in configuration', () => {
    const config = parseServerConfig({
      ...required,
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
    });

    expect(config.GOOGLE_CLIENT_ID).toBe('client');
    expect(config.GOOGLE_CLIENT_SECRET).toBe('secret');
  });

  it('rejects invalid ports', () => {
    expect(() => parseServerConfig({ ...required, PORT: 'nope' })).toThrow(ConfigError);
  });

  it('rejects URLs for the wrong service', () => {
    expect(() =>
      parseServerConfig({ ...required, DATABASE_URL: 'http://localhost:5432/db' }),
    ).toThrow(/PostgreSQL/);
    expect(() => parseServerConfig({ ...required, REDIS_URL: 'http://localhost:6379' })).toThrow(
      /Redis/,
    );
    expect(() => parseServerConfig({ ...required, S3_ENDPOINT: 'redis://localhost:9090' })).toThrow(
      /HTTP/,
    );
  });
});

describe('web configuration', () => {
  it('defaults the API base URL', () => {
    expect(parseWebConfig({}).API_BASE_URL).toBe('http://localhost:4000');
  });

  it('reads an explicit API base URL and timeout', () => {
    const config = parseWebConfig({
      API_BASE_URL: 'https://api.example.test',
      API_REQUEST_TIMEOUT_MS: '1500',
    });

    expect(config.API_BASE_URL).toBe('https://api.example.test');
    expect(config.API_REQUEST_TIMEOUT_MS).toBe(1500);
  });
});
