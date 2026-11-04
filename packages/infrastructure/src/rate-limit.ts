import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

export function createRateLimitCounter(redis: Redis) {
  return async (key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> => {
    const [count, ttl] = (await redis.eval(script, 1, `rate:${key}`, windowSeconds)) as [
      number,
      number,
    ];
    return { allowed: count <= limit, retryAfterSeconds: Math.max(1, ttl) };
  };
}
