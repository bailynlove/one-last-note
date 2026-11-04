import { RETENTION, type RetentionPolicy } from '@oln/domain';

export interface RetentionResult {
  auditEvents: number;
  failedCaptures: number;
  acceptedCaptureMetadata: number;
  rejectedRevisions: number;
  sessions: number;
  agentTokens: number;
  magicLinks: number;
}

export interface RetentionStore {
  purge(
    now: Date,
    policy: RetentionPolicy,
    deleteObjects: (keys: string[]) => Promise<void>,
  ): Promise<RetentionResult>;
}

export interface RetentionLogger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export class RetentionService {
  private readonly now: () => Date;
  private readonly policy: RetentionPolicy;

  constructor(
    private readonly options: {
      store: RetentionStore;
      storage: { deleteMany(keys: string[]): Promise<void> };
      now?: () => Date;
      policy?: RetentionPolicy;
      logger?: RetentionLogger;
    },
  ) {
    this.now = options.now ?? (() => new Date());
    this.policy = options.policy ?? RETENTION;
  }

  async purge(): Promise<RetentionResult> {
    const result = await this.options.store.purge(this.now(), this.policy, (keys) =>
      this.options.storage.deleteMany(keys),
    );
    this.options.logger?.info({ ...result }, 'retention purge completed');
    return result;
  }
}
