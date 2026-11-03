export type DependencyStatus = 'ok' | 'unavailable';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
  message?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  checks: Record<string, DependencyCheck>;
  checkedAt: string;
}

export interface ServiceHealth {
  status: 'ok';
  service: string;
  uptimeSeconds: number;
}

export function readinessStatus(
  checks: Record<string, DependencyCheck>,
): ReadinessReport['status'] {
  return Object.values(checks).every((check) => check.status === 'ok') ? 'ok' : 'degraded';
}

export function buildReadinessReport(
  checks: Record<string, DependencyCheck>,
  checkedAt = new Date().toISOString(),
): ReadinessReport {
  return {
    status: readinessStatus(checks),
    checks,
    checkedAt,
  };
}
