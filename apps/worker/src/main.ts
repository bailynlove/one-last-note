import { NoteService } from '@oln/application';
import { loadServerConfig } from '@oln/config';
import {
  createClamAvScanner,
  createDatabase,
  createDevelopmentScanner,
  createLogger,
  createNoteRevisionQueue,
  createNoteStore,
  createRedis,
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

const database = createDatabase({ connectionString: config.DATABASE_URL });
const storage = objectStorageFromConfig(config);
const queue = new Queue(SYSTEM_QUEUE, { connection: queueConnection });
await scheduleHeartbeat(queue);
const revisionQueue = createNoteRevisionQueue(config.REDIS_URL, onError);
const notes = new NoteService({
  store: createNoteStore(database),
  storage: storageAdapter(storage),
  scanner: config.CLAMAV_HOST
    ? createClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT })
    : createDevelopmentScanner(),
  logger,
});

const worker = new Worker(SYSTEM_QUEUE, processHeartbeat(logger), {
  connection: workerConnection,
  concurrency: config.WORKER_CONCURRENCY,
});
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

worker.on('failed', (job, error) => {
  logger.error({ err: error, jobId: job?.id }, 'job failed');
});
worker.on('error', (error) => {
  logger.error({ err: error }, 'worker error');
});
noteWorker.on('failed', (job, error) => {
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

await Promise.all([
  new Promise<void>((resolve, reject) => {
    worker.once('ready', () => resolve());
    worker.once('error', (error) => reject(error));
  }),
  new Promise<void>((resolve, reject) => {
    noteWorker.once('ready', () => resolve());
    noteWorker.once('error', (error) => reject(error));
  }),
]);

logger.info(
  { queues: [SYSTEM_QUEUE, NOTE_REVISION_QUEUE], concurrency: config.WORKER_CONCURRENCY },
  'worker ready',
);

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
      queue.close(),
      revisionQueue.close(),
      database.close(),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'worker shutdown step failed');
        process.exitCode = 1;
      }
    }
  } finally {
    queueConnection.disconnect();
    workerConnection.disconnect();
    noteWorkerConnection.disconnect();
    storage.destroy();
    clearTimeout(forceExit);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
