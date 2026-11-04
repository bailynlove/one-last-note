import { randomUUID } from 'node:crypto';
import {
  type AnnotationService,
  type AuthService,
  type CaptureService,
  CheckReadiness,
  type ExtensionAuthService,
  type KnowledgeBaseService,
  type LifecycleService,
  type NoteService,
  type ReadinessChecker,
  type RelationService,
} from '@oln/application';
import { loadServerConfig, type ServerConfig } from '@oln/config';
import {
  createDatabase,
  createLogger,
  createRedis,
  type Database,
  databaseProbe,
  ObjectStorage,
  objectStorageFromConfig,
  redisProbe,
  storageProbe,
} from '@oln/infrastructure';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import { buildApi } from '../apps/api/src/app';

export interface TestStack {
  config: ServerConfig;
  database: Database;
  redis: Redis;
  storage: ObjectStorage;
  close(): Promise<void>;
}

export function testConfig(): ServerConfig {
  return loadServerConfig();
}

export function testStorage(config: ServerConfig, bucket: string): ObjectStorage {
  return new ObjectStorage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export async function startTestStack(): Promise<TestStack> {
  const config = testConfig();
  const database = createDatabase({ connectionString: config.DATABASE_URL });
  const redis = createRedis(config.REDIS_URL);
  const storage = objectStorageFromConfig(config);

  return {
    config,
    database,
    redis,
    storage,
    async close() {
      redis.disconnect();
      await database.close();
      storage.destroy();
    },
  };
}

export function testReadiness(stack: TestStack): ReadinessChecker {
  return new CheckReadiness([
    databaseProbe(stack.database),
    redisProbe(stack.redis),
    storageProbe(stack.storage),
  ]);
}

export function startTestApi(
  readiness: ReadinessChecker,
  options: {
    auth?: AuthService;
    knowledgeBases?: KnowledgeBaseService;
    notes?: NoteService;
    annotations?: AnnotationService;
    lifecycle?: LifecycleService;
    captures?: CaptureService;
    extensionAuth?: ExtensionAuthService;
    relations?: RelationService;
    trustProxy?: number;
    authProxySecret?: string;
  } = {},
): FastifyInstance {
  return buildApi({
    logger: createLogger({ service: 'api-test', level: 'silent' }),
    readiness,
    auth: options.auth,
    knowledgeBases: options.knowledgeBases,
    notes: options.notes,
    annotations: options.annotations,
    lifecycle: options.lifecycle,
    captures: options.captures,
    extensionAuth: options.extensionAuth,
    relations: options.relations,
    authProxySecret: options.authProxySecret,
    trustProxy: options.trustProxy,
  });
}
