import { AppError, AUTH_THROTTLE_LIMIT, AUTH_THROTTLE_WINDOW_SECONDS } from '@oln/application';
import type Redis from 'ioredis';

const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('TTL', KEYS[1])}
`;

export function createAuthThrottle(
  redis: Redis,
  limit = AUTH_THROTTLE_LIMIT,
  windowSeconds = AUTH_THROTTLE_WINDOW_SECONDS,
): {
  consume(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
} {
  return {
    async consume(key) {
      try {
        const result = (await redis.eval(
          script,
          1,
          `auth:throttle:${key}`,
          String(windowSeconds),
        )) as [number, number];
        const [count, ttl] = result;

        return {
          allowed: count <= limit,
          retryAfterSeconds: count <= limit ? 0 : Math.max(1, ttl),
        };
      } catch (error) {
        throw new AppError('Sign-in is temporarily unavailable.', {
          status: 503,
          title: 'Sign-in unavailable',
          cause: error,
        });
      }
    },
  };
}
