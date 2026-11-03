import { CheckReadiness } from '@oln/application';
import { loadServerConfig } from '@oln/config';
import {
  createDatabase,
  createLogger,
  createRedis,
  databaseProbe,
  objectStorageFromConfig,
  redisProbe,
  storageProbe,
} from '@oln/infrastructure';
import { buildApi } from './app';

let config: ReturnType<typeof loadServerConfig>;

try {
  config = loadServerConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger({ service: 'api', level: config.LOG_LEVEL });
const database = createDatabase({
  connectionString: config.DATABASE_URL,
  onError: (error) => logger.error({ err: error }, 'database pool error'),
});
const redis = createRedis(config.REDIS_URL, {
  onError: (error) => logger.warn({ err: error }, 'redis connection error'),
});
const storage = objectStorageFromConfig(config);

const app = buildApi({
  logger,
  readiness: new CheckReadiness([
    databaseProbe(database),
    redisProbe(redis),
    storageProbe(storage),
  ]),
});

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  logger.info({ signal }, 'api stopping');

  const forceExit = setTimeout(() => {
    logger.fatal({ signal }, 'api shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    const results = await Promise.allSettled([
      app.close(),
      database.close(),
      (async () => redis.disconnect())(),
      (async () => storage.destroy())(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'api shutdown step failed');
        process.exitCode = 1;
      }
    }
  } finally {
    clearTimeout(forceExit);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: config.API_HOST });
  logger.info({ port: config.PORT, host: config.API_HOST }, 'api listening');
} catch (error) {
  logger.fatal({ err: error }, 'api failed to start');
  process.exit(1);
}
