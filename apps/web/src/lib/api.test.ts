import { describe, expect, it } from 'vitest';
import { isReadinessReport } from './api';

const report = {
  status: 'ok',
  checkedAt: '2026-01-01T00:00:00.000Z',
  checks: { database: { status: 'ok', latencyMs: 1 } },
};

describe('isReadinessReport', () => {
  it('accepts a complete report', () => {
    expect(isReadinessReport(report)).toBe(true);
  });

  it('rejects missing or malformed checks', () => {
    expect(isReadinessReport(null)).toBe(false);
    expect(isReadinessReport({ ...report, checks: { database: { status: 'ok' } } })).toBe(false);
    expect(isReadinessReport({ ...report, checks: [] })).toBe(false);
    expect(isReadinessReport({ ...report, status: 'unknown' })).toBe(false);
  });
});
