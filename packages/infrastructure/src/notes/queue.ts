import type { RevisionQueue } from '@oln/application';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { createRedis } from '../redis/client';

export const NOTE_REVISION_QUEUE = 'note-revisions';
export const NOTE_REVISION_JOB = 'process-revision';

export interface NoteRevisionQueue {
  queue: Queue;
  revisions: RevisionQueue;
  close(): Promise<void>;
}

export function revisionQueueAdapter(queue: Queue): RevisionQueue {
  return {
    async enqueueRevision(revisionId) {
      await queue.add(
        NOTE_REVISION_JOB,
        { revisionId },
        {
          jobId: revisionId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      );
    },
  };
}

export function noteRevisionQueue(queue: Queue, connection?: Redis): NoteRevisionQueue {
  return {
    queue,
    revisions: revisionQueueAdapter(queue),
    async close() {
      await queue.close();
      connection?.disconnect();
    },
  };
}

export function createNoteRevisionQueue(
  redisUrl: string,
  onError?: (error: Error) => void,
): NoteRevisionQueue {
  const connection = createRedis(redisUrl, { maxRetriesPerRequest: null, onError });
  const queue = new Queue(NOTE_REVISION_QUEUE, { connection });
  return noteRevisionQueue(queue, connection);
}
