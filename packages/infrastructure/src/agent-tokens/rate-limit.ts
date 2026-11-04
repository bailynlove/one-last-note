import type { Redis } from 'ioredis';

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

const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

export function createAgentRateLimiter(redis: Redis): AgentRateLimiter {
  return {
    async consume(tokenId, kind, limit, windowSeconds) {
      const key = `agent:rate:${tokenId}:${kind}`;
      const [count, ttl] = (await redis.eval(script, 1, key, windowSeconds)) as [number, number];
      return {
        allowed: count <= limit,
        retryAfterSeconds: Math.max(1, ttl),
      };
    },
  };
}
