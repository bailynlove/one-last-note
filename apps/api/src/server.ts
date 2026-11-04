import { AuthService, CheckReadiness } from '@oln/application';
import { loadServerConfig } from '@oln/config';
import { GOOGLE_CALLBACK_PATH } from '@oln/domain';
import {
  createAuthStore,
  createAuthThrottle,
  createDatabase,
  createGoogleProvider,
  createLogger,
  createMagicLinkEmailSender,
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

if (config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test' && !config.RESEND_API_KEY) {
  logger.fatal('RESEND_API_KEY is required in production so magic links are not logged');
  process.exit(1);
}
const database = createDatabase({
  connectionString: config.DATABASE_URL,
  onError: (error) => logger.error({ err: error }, 'database pool error'),
});
const redis = createRedis(config.REDIS_URL, {
  onError: (error) => logger.warn({ err: error }, 'redis connection error'),
});
const storage = objectStorageFromConfig(config);
const google =
  config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    ? createGoogleProvider({
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        redirectUri: new URL(GOOGLE_CALLBACK_PATH, config.WEB_APP_URL).toString(),
      })
    : undefined;
const auth = new AuthService({
  store: createAuthStore(database),
  email: createMagicLinkEmailSender({
    apiKey: config.RESEND_API_KEY,
    from: config.AUTH_EMAIL_FROM,
    logger,
  }),
  throttle: createAuthThrottle(redis),
  google,
  webAppUrl: config.WEB_APP_URL,
  logger,
});

const app = buildApi({
  logger,
  auth,
  authProxySecret: config.AUTH_PROXY_SECRET,
  trustProxy: config.TRUST_PROXY_HOPS,
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
    try {
      await app.close();
    } catch (error) {
      logger.error({ err: error }, 'api server failed to close');
      process.exitCode = 1;
    }

    const results = await Promise.allSettled([
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
