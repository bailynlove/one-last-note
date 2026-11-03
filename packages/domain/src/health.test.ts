import { describe, expect, it } from 'vitest';
import { buildReadinessReport, readinessStatus } from './health';

describe('readiness', () => {
  it('is ready when every dependency is ok', () => {
    const report = buildReadinessReport(
      {
        database: { status: 'ok', latencyMs: 2 },
        redis: { status: 'ok', latencyMs: 1 },
      },
      '2026-01-01T00:00:00.000Z',
    );

    expect(report.status).toBe('ok');
    expect(report.checkedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is degraded when any dependency is unavailable', () => {
    const report = buildReadinessReport({
      database: { status: 'ok', latencyMs: 2 },
      storage: { status: 'unavailable', latencyMs: 2000, message: 'NotFound' },
    });

    expect(report.status).toBe('degraded');
    expect(report.checks.storage?.message).toBe('NotFound');
  });

  it('treats an empty dependency set as ready', () => {
    expect(readinessStatus({})).toBe('ok');
  });
});
