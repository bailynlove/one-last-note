import { createLogger, createMetrics } from '@oln/infrastructure';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApi } from './app';

const app = buildApi({
  logger: createLogger({ service: 'api-test', level: 'silent' }),
  readiness: {
    execute: async () => ({ status: 'ok', checks: {}, checkedAt: new Date().toISOString() }),
  },
  metrics: createMetrics(),
  metricsToken: 'metrics-secret-token',
});

afterAll(async () => {
  await app.close();
});

describe('metrics', () => {
  it('applies a global request limit with retry-after', async () => {
    const limited = buildApi({
      logger: createLogger({ service: 'api-test', level: 'silent' }),
      readiness: {
        execute: async () => ({ status: 'ok', checks: {}, checkedAt: new Date().toISOString() }),
      },
      requestLimiter: async () => ({ allowed: false, retryAfterSeconds: 9 }),
    });
    const response = await limited.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('9');
    await limited.close();
  });

  it('requires the metrics token and exposes request metrics', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    const unauthorized = await app.inject({ method: 'GET', url: '/metrics' });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer metrics-secret-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('api_requests_total');
    expect(response.body).toContain('route="/health"');
    expect(response.body).toContain('api_request_duration_seconds_count');
  });
});
