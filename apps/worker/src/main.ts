import { createServer } from 'node:http';
import { CaptureService, LifecycleService, NoteService, RetentionService } from '@oln/application';
import { loadServerConfig } from '@oln/config';
import {
  CAPTURE_QUEUE,
  captureQueueAdapter,
  createCaptureQueue,
  createCaptureStore,
  createClamAvScanner,
  createDatabase,
  createDevelopmentScanner,
  createLifecycleStore,
  createLogger,
  createMetrics,
  createNoteRevisionQueue,
  createNoteStore,
  createRedis,
  createRetentionStore,
  createSafeFetcher,
  NOTE_REVISION_QUEUE,
  objectStorageFromConfig,
  processHeartbeat,
  SYSTEM_QUEUE,
  scheduleHeartbeat,
  storageAdapter,
} from '@oln/infrastructure';
import { Queue, Worker } from 'bullmq';

let config: ReturnType<typeof loadServerConfig>;

try {
  config = loadServerConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger({ service: 'worker', level: config.LOG_LEVEL });
if (config.NODE_ENV === 'production' && !config.CLAMAV_HOST) {
  logger.fatal('CLAMAV_HOST is required in production');
  process.exit(1);
}
const onError = (error: Error): void => logger.warn({ err: error }, 'redis connection error');

// BullMQ needs null retries; it manages its own blocking commands and reconnections.
const queueConnection = createRedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  onError,
});
const workerConnection = createRedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  onError,
});
const noteWorkerConnection = createRedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  onError,
});
const captureWorkerConnection = createRedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  onError,
});

const database = createDatabase({ connectionString: config.DATABASE_URL });
const storage = objectStorageFromConfig(config);
const queue = new Queue(SYSTEM_QUEUE, { connection: queueConnection });
await scheduleHeartbeat(queue);
const revisionQueue = createNoteRevisionQueue(config.REDIS_URL, onError);
const lifecycle = new LifecycleService({ store: createLifecycleStore(database) });
const retention = new RetentionService({
  store: createRetentionStore(database),
  storage: {
    deleteMany: async (keys) => {
      for (const key of keys) await storage.deleteObject(key);
    },
  },
  logger,
});
const metrics = createMetrics();
const scanner = config.CLAMAV_HOST
  ? createClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT })
  : createDevelopmentScanner();
const notes = new NoteService({
  store: createNoteStore(database),
  storage: storageAdapter(storage),
  scanner,
  logger,
});
const captureQueue = createCaptureQueue(config.REDIS_URL, onError);
const captures = new CaptureService({
  store: createCaptureStore(database),
  fetcher: createSafeFetcher(),
  queue: captureQueueAdapter(captureQueue.queue),
  notes,
  storage: storageAdapter(storage),
  scanner,
  logger,
});

const worker = new Worker(SYSTEM_QUEUE, processHeartbeat(logger), {
  connection: workerConnection,
  concurrency: config.WORKER_CONCURRENCY,
});
const captureWorker = new Worker(
  CAPTURE_QUEUE,
  async (job) => {
    const attemptId = (job.data as { attemptId?: unknown }).attemptId;
    if (typeof attemptId !== 'string') {
      throw new Error('Capture job is missing attemptId');
    }
    await captures.process(attemptId);
  },
  { connection: captureWorkerConnection, concurrency: 2 },
);
const noteWorker = new Worker(
  NOTE_REVISION_QUEUE,
  async (job) => {
    const revisionId = (job.data as { revisionId?: unknown }).revisionId;
    if (typeof revisionId !== 'string') {
      throw new Error('Revision job is missing revisionId');
    }
    await notes.processRevision(revisionId);
  },
  { connection: noteWorkerConnection, concurrency: config.WORKER_CONCURRENCY },
);

worker.on('completed', () =>
  metrics.inc('worker_jobs_total', { queue: SYSTEM_QUEUE, status: 'completed' }),
);
worker.on('failed', (job, error) => {
  metrics.inc('worker_jobs_total', { queue: SYSTEM_QUEUE, status: 'failed' });
  logger.error({ err: error, jobId: job?.id }, 'job failed');
});
worker.on('error', (error) => {
  logger.error({ err: error }, 'worker error');
});
noteWorker.on('completed', () =>
  metrics.inc('worker_jobs_total', { queue: NOTE_REVISION_QUEUE, status: 'completed' }),
);
noteWorker.on('failed', (job, error) => {
  metrics.inc('worker_jobs_total', { queue: NOTE_REVISION_QUEUE, status: 'failed' });
  logger.error({ err: error, jobId: job?.id }, 'revision job failed');
  const revisionId = (job?.data as { revisionId?: unknown } | undefined)?.revisionId;
  const attempts = job?.opts.attempts ?? 1;
  if (typeof revisionId === 'string' && job && job.attemptsMade >= attempts) {
    void notes.markRevisionFailed(revisionId).catch((failure) => {
      logger.error({ err: failure, revisionId }, 'marking failed Revision rejected');
    });
  }
});
noteWorker.on('error', (error) => {
  logger.error({ err: error }, 'revision worker error');
});
captureWorker.on('completed', () =>
  metrics.inc('worker_jobs_total', { queue: CAPTURE_QUEUE, status: 'completed' }),
);
captureWorker.on('failed', (job, error) => {
  metrics.inc('worker_jobs_total', { queue: CAPTURE_QUEUE, status: 'failed' });
  logger.error({ err: error, jobId: job?.id }, 'capture job failed');
});
captureWorker.on('error', (error) => {
  logger.error({ err: error }, 'capture worker error');
});

const metricsServer = createServer((request, response) => {
  if (request.url !== '/metrics') {
    response.writeHead(404).end();
    return;
  }
  if (config.METRICS_TOKEN && request.headers.authorization !== `Bearer ${config.METRICS_TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
  response.end(metrics.render());
});
metricsServer.listen(config.METRICS_PORT, '0.0.0.0', () => {
  logger.info({ port: config.METRICS_PORT }, 'worker metrics listening');
});

let refreshing = false;
async function refreshQueueMetrics(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const [system, revisions, captures] = await Promise.all([
      queue.getJobCounts(),
      revisionQueue.queue.getJobCounts(),
      captureQueue.queue.getJobCounts(),
    ]);
    for (const [state, value] of Object.entries(system))
      metrics.gauge('queue_jobs', { queue: SYSTEM_QUEUE, state }, value);
    for (const [state, value] of Object.entries(revisions))
      metrics.gauge('queue_jobs', { queue: NOTE_REVISION_QUEUE, state }, value);
    for (const [state, value] of Object.entries(captures))
      metrics.gauge('queue_jobs', { queue: CAPTURE_QUEUE, state }, value);
  } catch (error) {
    logger.warn({ err: error }, 'queue metrics refresh failed');
  } finally {
    refreshing = false;
  }
}
const queueMetricsTimer = setInterval(() => void refreshQueueMetrics(), 30_000);
queueMetricsTimer.unref();
void refreshQueueMetrics();

await Promise.all([
  new Promise<void>((resolve, reject) => {
    worker.once('ready', () => resolve());
    worker.once('error', (error) => reject(error));
  }),
  new Promise<void>((resolve, reject) => {
    noteWorker.once('ready', () => resolve());
    noteWorker.once('error', (error) => reject(error));
  }),
  new Promise<void>((resolve, reject) => {
    captureWorker.once('ready', () => resolve());
    captureWorker.once('error', (error) => reject(error));
  }),
]);

logger.info(
  {
    queues: [SYSTEM_QUEUE, NOTE_REVISION_QUEUE, CAPTURE_QUEUE],
    concurrency: config.WORKER_CONCURRENCY,
  },
  'worker ready',
);

let purging = false;
async function purgeTrash(): Promise<void> {
  if (purging) return;
  purging = true;
  try {
    const result = await lifecycle.purgeDue(async (keys) => {
      for (const key of keys) await storage.deleteObject(key);
    });
    if (result.associations + result.knowledgeBases + result.notes > 0) {
      logger.info(result, 'trash purged');
    }
  } catch (error) {
    logger.error({ err: error }, 'trash purge failed');
  } finally {
    purging = false;
  }
}

const purgeTimer = setInterval(() => void purgeTrash(), 60 * 60 * 1000);
purgeTimer.unref();
void purgeTrash();

let retaining = false;
async function purgeRetention(): Promise<void> {
  if (retaining) return;
  retaining = true;
  try {
    await retention.purge();
  } catch (error) {
    logger.error({ err: error }, 'retention purge failed');
  } finally {
    retaining = false;
  }
}

const retentionTimer = setInterval(() => void purgeRetention(), 24 * 60 * 60 * 1000);
retentionTimer.unref();
void purgeRetention();

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  logger.info({ signal }, 'worker stopping');

  const forceExit = setTimeout(() => {
    logger.fatal({ signal }, 'worker shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    const results = await Promise.allSettled([
      worker.close(),
      noteWorker.close(),
      captureWorker.close(),
      queue.close(),
      revisionQueue.close(),
      captureQueue.close(),
      database.close(),
      new Promise<void>((resolve) => metricsServer.close(() => resolve())),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'worker shutdown step failed');
        process.exitCode = 1;
      }
    }
  } finally {
    clearInterval(purgeTimer);
    clearInterval(retentionTimer);
    clearInterval(queueMetricsTimer);
    queueConnection.disconnect();
    workerConnection.disconnect();
    noteWorkerConnection.disconnect();
    captureWorkerConnection.disconnect();
    storage.destroy();
    clearTimeout(forceExit);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
