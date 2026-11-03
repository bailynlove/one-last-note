import { createRedis, HEARTBEAT_JOB, scheduleHeartbeat } from '@oln/infrastructure';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { testConfig, uniqueName } from './fixtures';

const config = testConfig();
const queueName = uniqueName('system-it');
const connections: Redis[] = [];

function connect(): Redis {
  const connection = createRedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  connections.push(connection);
  return connection;
}

const queue = new Queue(queueName, { connection: connect() });
const worker = new Worker(
  queueName,
  async (job) => {
    return { handled: job.name };
  },
  { connection: connect() },
);

afterAll(async () => {
  await worker.close();
  await queue.close();
  for (const connection of connections) {
    connection.disconnect();
  }
});

describe('queue foundation', () => {
  it('registers the heartbeat scheduler and processes jobs', async () => {
    await worker.waitUntilReady();
    await scheduleHeartbeat(queue);

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toContain('system-heartbeat');
    await queue.removeJobScheduler('system-heartbeat');

    let markHandled: (() => void) | undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    worker.on('completed', (job) => {
      if (job.name === HEARTBEAT_JOB && job.data?.probe === true) {
        markHandled?.();
      }
    });

    await queue.add(HEARTBEAT_JOB, { probe: true });
    await Promise.race([
      handled,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('job was not processed within 10s')), 10_000),
      ),
    ]);
  });
});
