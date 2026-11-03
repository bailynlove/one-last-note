import { AppError } from '@oln/application';
import { buildReadinessReport, type DependencyCheck } from '@oln/domain';
import { createLogger } from '@oln/infrastructure';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApi } from './app';

const logger = createLogger({ service: 'api-test', level: 'silent' });
let app: ReturnType<typeof buildApi> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('api', () => {
  it('serves health with request id and no-store headers', async () => {
    app = buildApi({
      logger,
      readiness: { execute: async () => buildReadinessReport({}) },
      now: () => new Date(),
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' });
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 200 when ready and 503 when degraded', async () => {
    let checks: Record<string, DependencyCheck> = {
      database: { status: 'ok', latencyMs: 1 },
    };
    app = buildApi({
      logger,
      readiness: { execute: async () => buildReadinessReport(checks) },
    });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok' });

    checks = {
      database: { status: 'unavailable', latencyMs: 1, message: 'ECONNREFUSED' },
    };
    const degraded = await app.inject({ method: 'GET', url: '/ready' });
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json()).toMatchObject({ status: 'degraded' });
  });

  it('serializes unknown routes as problem+json', async () => {
    app = buildApi({ logger, readiness: { execute: async () => buildReadinessReport({}) } });

    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, title: 'Not Found' });
  });

  it('keeps AppError details for clients and hides internal failures', async () => {
    app = buildApi({ logger, readiness: { execute: async () => buildReadinessReport({}) } });

    app.get('/conflict', async () => {
      throw new AppError('already exists', { status: 409, title: 'Conflict' });
    });
    app.get('/boom', async () => {
      throw new Error('secret connection string');
    });

    const conflict = await app.inject({ method: 'GET', url: '/conflict' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      status: 409,
      title: 'Conflict',
      detail: 'already exists',
    });

    const failure = await app.inject({ method: 'GET', url: '/boom' });
    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toMatchObject({ status: 500, detail: 'An unexpected error occurred.' });
    expect(failure.body).not.toContain('secret connection string');
  });
});
