import type { CaptureQueue } from '@oln/application';
import { Queue } from 'bullmq';
import { createRedis } from '../redis/client';

export const CAPTURE_QUEUE = 'web-captures';
export const CAPTURE_JOB = 'process-capture';

export function captureQueueAdapter(queue: Queue): CaptureQueue {
  return {
    async enqueueCapture(attemptId) {
      await queue.add(
        CAPTURE_JOB,
        { attemptId },
        {
          jobId: attemptId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: 1000,
          removeOnFail: true,
        },
      );
    },
  };
}

export function createCaptureQueue(
  redisUrl: string,
  onError?: (error: Error) => void,
): { queue: Queue; close: () => Promise<void> } {
  const connection = createRedis(redisUrl, { maxRetriesPerRequest: null, onError });
  const queue = new Queue(CAPTURE_QUEUE, { connection });
  return {
    queue,
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
