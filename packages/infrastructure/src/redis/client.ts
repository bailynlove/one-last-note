import Redis from 'ioredis';

export interface CreateRedisOptions {
  maxRetriesPerRequest?: number | null;
  onError?: (error: Error) => void;
}

export function createRedis(url: string, options: CreateRedisOptions = {}): Redis {
  const client = new Redis(url, {
    // BullMQ needs null and handles its own reconnects; everyone else fails within one retry.
    maxRetriesPerRequest:
      options.maxRetriesPerRequest === undefined ? 1 : options.maxRetriesPerRequest,
    commandTimeout: options.maxRetriesPerRequest === null ? undefined : 2_000,
    connectTimeout: 2_000,
    enableOfflineQueue: true,
  });

  client.on('error', (error) => options.onError?.(error));

  return client;
}
