import { CheckReadiness } from '@oln/application';
import {
  createDatabase,
  createRedis,
  databaseProbe,
  redisProbe,
  storageProbe,
} from '@oln/infrastructure';
import { afterAll, describe, expect, it } from 'vitest';
import {
  startTestApi,
  startTestStack,
  type TestStack,
  testReadiness,
  testStorage,
  uniqueName,
} from './fixtures';

let stack: TestStack | undefined;
let extraStorage: ReturnType<typeof testStorage> | undefined;

afterAll(async () => {
  extraStorage?.destroy();
  await stack?.close();
});

describe('readiness with real backing services', () => {
  it('reports ready when postgres, redis and storage all answer', async () => {
    stack = await startTestStack();
    const app = startTestApi(testReadiness(stack));

    const response = await app.inject({ method: 'GET', url: '/ready' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'ok' },
        redis: { status: 'ok' },
        storage: { status: 'ok' },
      },
    });
  });

  it('degrades when a backing service is unavailable', async () => {
    if (!stack) {
      stack = await startTestStack();
    }

    extraStorage = testStorage(stack.config, uniqueName('missing-bucket'));
    const readiness = new CheckReadiness([storageProbe(extraStorage)]);
    const app = startTestApi(readiness);

    const response = await app.inject({ method: 'GET', url: '/ready' });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      checks: { storage: { status: 'unavailable' } },
    });
  });

  it('degrades when postgres is unavailable', async () => {
    const database = createDatabase({
      connectionString: 'postgresql://one_last_note:one_last_note@127.0.0.1:1/one_last_note',
    });
    const app = startTestApi(new CheckReadiness([databaseProbe(database)]));

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        checks: { database: { status: 'unavailable' } },
      });
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('degrades when redis is unavailable', async () => {
    const redis = createRedis('redis://127.0.0.1:1');
    redis.on('error', () => {});
    const app = startTestApi(new CheckReadiness([redisProbe(redis)]));

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        checks: { redis: { status: 'unavailable' } },
      });
    } finally {
      redis.disconnect();
      await app.close();
    }
  });
});
