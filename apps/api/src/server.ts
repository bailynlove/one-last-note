import {
  AgentControlService,
  AgentTokenService,
  AnnotationService,
  AppExtensionService,
  AuthService,
  CaptureService,
  CheckReadiness,
  ExtensionAuthService,
  KnowledgeBaseService,
  LifecycleService,
  NoteService,
  RelationService,
} from '@oln/application';
import { loadServerConfig } from '@oln/config';
import {
  GOOGLE_CALLBACK_PATH,
  NOTE_UPLOAD_RATE_LIMIT,
  NOTE_UPLOAD_RATE_WINDOW_SECONDS,
} from '@oln/domain';
import {
  captureQueueAdapter,
  createAgentRateLimiter,
  createAgentTokenStore,
  createAnnotationStore,
  createAppExtensionStore,
  createAuthStore,
  createAuthThrottle,
  createCaptureQueue,
  createCaptureStore,
  createClamAvScanner,
  createConcurrencyGate,
  createDatabase,
  createDevelopmentScanner,
  createExtensionAuthStore,
  createGoogleProvider,
  createKnowledgeBaseEmailSender,
  createKnowledgeBaseStore,
  createLifecycleStore,
  createLogger,
  createMagicLinkEmailSender,
  createMetrics,
  createNoteRevisionQueue,
  createNoteStore,
  createRateLimitCounter,
  createRedis,
  createRelationStore,
  createSafeFetcher,
  databaseProbe,
  objectStorageFromConfig,
  redisProbe,
  storageAdapter,
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
if (config.NODE_ENV === 'production' && !config.CLAMAV_HOST) {
  logger.fatal('CLAMAV_HOST is required in production');
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
const revisionQueue = createNoteRevisionQueue(config.REDIS_URL, (error) =>
  logger.warn({ err: error }, 'revision queue connection error'),
);
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

const extensionAuth = new ExtensionAuthService({
  store: createExtensionAuthStore(database),
  auth,
  allowedExtensionId: config.SAVER_EXTENSION_ID,
});

const knowledgeBases = new KnowledgeBaseService({
  store: createKnowledgeBaseStore(database),
  email: createKnowledgeBaseEmailSender({
    apiKey: config.RESEND_API_KEY,
    from: config.AUTH_EMAIL_FROM,
    logger,
  }),
  webAppUrl: config.WEB_APP_URL,
  logger,
});

const lifecycle = new LifecycleService({ store: createLifecycleStore(database) });

const notes = new NoteService({
  store: createNoteStore(database),
  storage: storageAdapter(storage),
  scanner: config.CLAMAV_HOST
    ? createClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT })
    : createDevelopmentScanner(),
  queue: revisionQueue.revisions,
  // Local development without a worker releases inline; deployed processing is queued.
  processInline: !config.CLAMAV_HOST,
  logger,
  uploadLimiter: (userId) =>
    rateLimit(`note-upload:${userId}`, NOTE_UPLOAD_RATE_LIMIT, NOTE_UPLOAD_RATE_WINDOW_SECONDS),
  acquireUploadSlot: createConcurrencyGate(redis, 'upload-slot', config.ACTIVE_UPLOAD_LIMIT),
});

const relations = new RelationService({
  store: createRelationStore(database),
  notes,
  webAppUrl: config.WEB_APP_URL,
});

const captureQueue = createCaptureQueue(config.REDIS_URL, (error) =>
  logger.warn({ err: error }, 'capture queue connection error'),
);
const captures = new CaptureService({
  store: createCaptureStore(database),
  fetcher: createSafeFetcher(),
  queue: captureQueueAdapter(captureQueue.queue),
  notes,
  storage: storageAdapter(storage),
  scanner: config.CLAMAV_HOST
    ? createClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT })
    : createDevelopmentScanner(),
  logger,
});

const appExtensions = new AppExtensionService({
  store: createAppExtensionStore(database),
});

const rateLimit = createRateLimitCounter(redis);
const annotations = new AnnotationService({
  store: createAnnotationStore(database),
  noteText: (userId, noteId, revisionId) => notes.revisionText(userId, noteId, revisionId),
  markTypes: appExtensions,
});
const agentTokens = new AgentTokenService({
  store: createAgentTokenStore(database),
  logger,
});
const agentControl = new AgentControlService(
  { knowledgeBases, notes, annotations, relations, lifecycle },
  (agent, entry) =>
    agentTokens.audit(agent, entry.tool, entry.action, entry.subjectType, entry.subjectId),
);
const metrics = createMetrics();
metrics.addCollector(() => {
  const stats = database.stats();
  metrics.gauge('db_pool_connections', { state: 'total' }, stats.total);
  metrics.gauge('db_pool_connections', { state: 'idle' }, stats.idle);
  metrics.gauge('db_pool_connections', { state: 'waiting' }, stats.waiting);
  metrics.gauge('db_pool_max', {}, 10);
});
const app = buildApi({
  logger,
  auth,
  knowledgeBases,
  lifecycle,
  notes,
  captures,
  extensionAuth,
  relations,
  appExtensions,
  annotations,
  agentTokens,
  mcp: { control: agentControl, limiter: createAgentRateLimiter(redis) },
  metrics,
  metricsToken: config.METRICS_TOKEN,
  requestLimiter: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds),
  identityLimiter: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds),
  identityLimit: {
    read: config.AUTHENTICATED_READ_RATE_LIMIT,
    write: config.AUTHENTICATED_WRITE_RATE_LIMIT,
    windowSeconds: 60,
  },
  requestLimit: {
    limit: config.API_REQUEST_RATE_LIMIT,
    windowSeconds: config.API_REQUEST_RATE_WINDOW_SECONDS,
  },
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
      revisionQueue.close(),
      captureQueue.close(),
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
