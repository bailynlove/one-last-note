import { loadWebConfig } from '@oln/config';
import type { ReadinessReport } from '@oln/domain';

export type ReadinessResult = { reachable: true; report: ReadinessReport } | { reachable: false };

function isDependencyCheck(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'unavailable') &&
    'latencyMs' in value &&
    typeof value.latencyMs === 'number'
  );
}

export function isReadinessReport(value: unknown): value is ReadinessReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const report = value as Partial<ReadinessReport>;
  return (
    (report.status === 'ok' || report.status === 'degraded') &&
    typeof report.checkedAt === 'string' &&
    typeof report.checks === 'object' &&
    report.checks !== null &&
    !Array.isArray(report.checks) &&
    Object.values(report.checks).every(isDependencyCheck)
  );
}

export async function fetchReadiness(): Promise<ReadinessResult> {
  const config = loadWebConfig();

  try {
    const response = await fetch(new URL('/ready', config.API_BASE_URL), {
      cache: 'no-store',
      signal: AbortSignal.timeout(config.API_REQUEST_TIMEOUT_MS),
    });

    if (response.status !== 200 && response.status !== 503) {
      return { reachable: false };
    }

    const report: unknown = await response.json();
    return isReadinessReport(report) ? { reachable: true, report } : { reachable: false };
  } catch {
    return { reachable: false };
  }
}
