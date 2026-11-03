import { buildReadinessReport, type ReadinessReport } from '@oln/domain';

export interface Probe {
  name: string;
  check(): Promise<void>;
}

export interface ReadinessChecker {
  execute(): Promise<ReadinessReport>;
}

export class CheckReadiness implements ReadinessChecker {
  constructor(
    private readonly probes: readonly Probe[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<ReadinessReport> {
    const entries = await Promise.all(
      this.probes.map(async (probe) => {
        const startedAt = performance.now();

        try {
          await probe.check();
          return [
            probe.name,
            { status: 'ok' as const, latencyMs: Math.round(performance.now() - startedAt) },
          ] as const;
        } catch (error) {
          return [
            probe.name,
            {
              status: 'unavailable' as const,
              latencyMs: Math.round(performance.now() - startedAt),
              message: failureDetail(error),
            },
          ] as const;
        }
      }),
    );

    return buildReadinessReport(Object.fromEntries(entries), this.now().toISOString());
  }
}

function failureDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string' && error.code.length > 0) {
      return error.code;
    }

    if ('name' in error && typeof error.name === 'string' && error.name !== 'Error') {
      return error.name;
    }
  }

  return 'Check failed';
}
