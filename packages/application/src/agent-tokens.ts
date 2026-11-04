import {
  AGENT_TOKEN_MAX_TTL_MS,
  AGENT_TOKEN_PREFIX,
  type AgentTokenScope,
  type AgentTokenSummary,
  type User,
} from '@oln/domain';
import { createToken, hashToken } from './auth';
import { AppError } from './errors';

export interface AgentTokenRecord extends AgentTokenSummary {
  userId: string;
  userEmail?: string;
  userDisplayName?: string;
  userAvatarUrl?: string | null;
}

export interface AgentTokenStore {
  create(input: {
    userId: string;
    name: string;
    tokenHash: string;
    prefix: string;
    scopes: AgentTokenScope[];
    expiresAt: Date;
    now: Date;
  }): Promise<AgentTokenRecord>;
  list(userId: string, now: Date): Promise<AgentTokenRecord[]>;
  revoke(userId: string, id: string, now: Date): Promise<boolean>;
  findByHash(tokenHash: string): Promise<AgentTokenRecord | null>;
  touch(id: string, now: Date): Promise<void>;
  audit(input: {
    tokenId: string;
    userId: string;
    agentName: string;
    tool: string;
    action: string;
    subjectType: string;
    subjectId: string | null;
  }): Promise<void>;
}

export interface AgentTokenLogger {
  error(details: unknown, message: string): void;
}

export interface AgentTokenServiceOptions {
  store: AgentTokenStore;
  logger?: AgentTokenLogger;
  now?: () => Date;
}

export interface AuthenticatedAgent {
  token: AgentTokenRecord;
  user: User;
}

export class AgentTokenService {
  private readonly now: () => Date;

  constructor(private readonly options: AgentTokenServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async create(
    user: User,
    input: { name: string; scopes?: AgentTokenScope[]; expiresInDays?: number },
  ): Promise<{ token: string; summary: AgentTokenSummary }> {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw new AppError('Token name must be 1–80 characters.', { status: 400 });
    }
    const requested: AgentTokenScope[] = input.scopes ?? ['read'];
    const scopes: AgentTokenScope[] = [...new Set(requested)];
    if (scopes.length === 0 || scopes.some((scope) => scope !== 'read' && scope !== 'write')) {
      throw new AppError('Scopes must be read and/or write.', { status: 400 });
    }
    const days = input.expiresInDays ?? 90;
    if (!Number.isInteger(days) || days < 1 || days * 86_400_000 > AGENT_TOKEN_MAX_TTL_MS) {
      throw new AppError('Token expiry must be 1–365 days.', { status: 400 });
    }
    const now = this.now();
    const token = `${AGENT_TOKEN_PREFIX}${createToken()}`;
    const record = await this.options.store.create({
      userId: user.id,
      name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, AGENT_TOKEN_PREFIX.length + 8),
      scopes,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
      now,
    });
    return { token, summary: summary(record) };
  }

  async list(user: User): Promise<AgentTokenSummary[]> {
    const rows = await this.options.store.list(user.id, this.now());
    return rows.map(summary);
  }

  async revoke(user: User, id: string): Promise<void> {
    const revoked = await this.options.store.revoke(user.id, id, this.now());
    if (!revoked) throw new AppError('Token not found.', { status: 404 });
  }

  async authenticate(raw: string): Promise<AuthenticatedAgent> {
    if (!raw.startsWith(AGENT_TOKEN_PREFIX)) {
      throw new AppError('Invalid Agent token.', { status: 401 });
    }
    const record = await this.options.store.findByHash(hashToken(raw));
    if (!record || record.revokedAt || new Date(record.expiresAt) <= this.now()) {
      throw new AppError('Invalid or expired Agent token.', { status: 401 });
    }
    const user: User = {
      id: record.userId,
      email: record.userEmail ?? '',
      displayName: record.userDisplayName ?? record.name,
      avatarUrl: record.userAvatarUrl ?? null,
      createdAt: record.createdAt,
    };
    // Name/email are not needed by domain services; the store's join supplies identity via id.
    return { token: record, user };
  }

  async touch(auth: AuthenticatedAgent): Promise<void> {
    await this.options.store.touch(auth.token.id, this.now());
  }

  async audit(
    auth: AuthenticatedAgent,
    tool: string,
    action: string,
    subjectType: string,
    subjectId: string | null,
  ): Promise<void> {
    try {
      await this.options.store.audit({
        tokenId: auth.token.id,
        userId: auth.token.userId,
        agentName: auth.token.name,
        tool,
        action,
        subjectType,
        subjectId,
      });
    } catch (error) {
      this.options.logger?.error({ error, tool }, 'Failed to write Agent audit event');
      throw error;
    }
  }
}

function summary(record: AgentTokenRecord): AgentTokenSummary {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
  };
}
