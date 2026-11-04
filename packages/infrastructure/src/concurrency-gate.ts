import type { Redis } from 'ioredis';

const acquireScript = `
local count = redis.call('INCR', KEYS[1])
if count > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const releaseScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then redis.call('DECR', KEYS[1]) end
return 1
`;

export function createConcurrencyGate(
  redis: Redis,
  key: string,
  limit: number,
  ttlSeconds = 120,
): () => Promise<(() => Promise<void>) | null> {
  return async () => {
    const acquired = (await redis.eval(
      acquireScript,
      1,
      `gate:${key}`,
      limit,
      ttlSeconds,
    )) as number;
    if (!acquired) return null;

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await redis.eval(releaseScript, 1, `gate:${key}`);
    };
  };
}
