import { describe, expect, it } from 'vitest';
import { CheckReadiness } from './readiness';

describe('CheckReadiness', () => {
  it('reports each dependency and never fails the whole check', async () => {
    const readiness = new CheckReadiness(
      [
        { name: 'database', check: async () => {} },
        {
          name: 'redis',
          check: async () => {
            throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
          },
        },
      ],
      () => new Date('2026-01-01T00:00:00.000Z'),
    );

    const report = await readiness.execute();

    expect(report.status).toBe('degraded');
    expect(report.checkedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(report.checks.database?.status).toBe('ok');
    expect(report.checks.redis?.status).toBe('unavailable');
    expect(report.checks.redis?.message).toBe('ECONNREFUSED');
  });

  it('falls back to a safe failure message', async () => {
    const readiness = new CheckReadiness([
      {
        name: 'storage',
        check: async () => {
          throw new Error('connection string with credentials');
        },
      },
    ]);

    const report = await readiness.execute();

    expect(report.checks.storage?.message).toBe('Check failed');
  });
});
