import { loadServerConfig } from '@oln/config';
import {
  createLogger,
  createRedis,
  processHeartbeat,
  SYSTEM_QUEUE,
  scheduleHeartbeat,
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

const queue = new Queue(SYSTEM_QUEUE, { connection: queueConnection });
await scheduleHeartbeat(queue);

const worker = new Worker(SYSTEM_QUEUE, processHeartbeat(logger), {
  connection: workerConnection,
  concurrency: config.WORKER_CONCURRENCY,
});

worker.on('failed', (job, error) => {
  logger.error({ err: error, jobId: job?.id }, 'job failed');
});
worker.on('error', (error) => {
  logger.error({ err: error }, 'worker error');
});

await new Promise<void>((resolve, reject) => {
  worker.once('ready', () => resolve());
  worker.once('error', (error) => reject(error));
});

logger.info({ queue: SYSTEM_QUEUE, concurrency: config.WORKER_CONCURRENCY }, 'worker ready');

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
    const results = await Promise.allSettled([worker.close(), queue.close()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'worker shutdown step failed');
        process.exitCode = 1;
      }
    }
  } finally {
    queueConnection.disconnect();
    workerConnection.disconnect();
    clearTimeout(forceExit);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
