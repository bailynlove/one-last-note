import type { Probe } from '@oln/application';
import type Redis from 'ioredis';

export function redisProbe(client: Redis): Probe {
  return {
    name: 'redis',
    check: async () => {
      const response = await client.ping();
      if (response !== 'PONG') {
        throw new Error(`Unexpected Redis response: ${response}`);
      }
    },
  };
}
