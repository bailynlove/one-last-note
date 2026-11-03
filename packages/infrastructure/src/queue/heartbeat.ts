import type { Job, Queue } from 'bullmq';
import type { Logger } from 'pino';

export const SYSTEM_QUEUE = 'system';
export const HEARTBEAT_JOB = 'heartbeat';
export const HEARTBEAT_INTERVAL_MS = 60_000;

export function processHeartbeat(logger: Logger) {
  return async (job: Job): Promise<void> => {
    logger.info({ jobId: job.id, queue: job.queueName }, 'worker heartbeat');
  };
}

export async function scheduleHeartbeat(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    'system-heartbeat',
    { every: HEARTBEAT_INTERVAL_MS },
    { name: HEARTBEAT_JOB, data: {} },
  );
}
