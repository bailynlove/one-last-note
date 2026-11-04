import type { Redis } from 'ioredis';
import { createRateLimitCounter } from '../rate-limit';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AgentRateLimiter {
  consume(
    tokenId: string,
    kind: 'request' | 'write',
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
}

export function createAgentRateLimiter(redis: Redis): AgentRateLimiter {
  const counter = createRateLimitCounter(redis);
  return {
    consume: (tokenId, kind, limit, windowSeconds) =>
      counter(`agent:${tokenId}:${kind}`, limit, windowSeconds),
  };
}
