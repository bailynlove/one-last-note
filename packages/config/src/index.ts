import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const baseEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const postgresUrl = z
  .url()
  .refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    'must be a PostgreSQL connection URL',
  );
const redisUrl = z
  .url()
  .refine(
    (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
    'must be a Redis connection URL',
  );
const httpUrl = z
  .url()
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
    'must be an HTTP(S) URL',
  );

export const serverEnvSchema = baseEnv
  .extend({
    PORT: z.coerce.number().int().positive().max(65_535).default(4000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    WEB_APP_URL: httpUrl.default('http://localhost:3000'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: httpUrl,
    S3_REGION: z.string().min(1).default('auto'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    RESEND_API_KEY: z.string().min(1).optional(),
    AUTH_PROXY_SECRET: z.string().min(32).optional(),
    API_REQUEST_RATE_LIMIT: z.coerce.number().int().positive().default(600),
    API_REQUEST_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_EMAIL_FROM: z.string().min(1).default('One Last Note <login@one-last-note.dev>'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    SAVER_EXTENSION_ID: z
      .string()
      .regex(/^[a-p]{32}$/)
      .optional(),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().positive().max(65_535).default(3310),
    METRICS_PORT: z.coerce.number().int().positive().max(65_535).default(9464),
    METRICS_TOKEN: z.string().min(16).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.SAVER_EXTENSION_ID) {
      context.addIssue({
        code: 'custom',
        path: ['SAVER_EXTENSION_ID'],
        message: 'SAVER_EXTENSION_ID is required in production',
      });
    }
    if (Boolean(value.GOOGLE_CLIENT_ID) !== Boolean(value.GOOGLE_CLIENT_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      });
    }
  });

export const webEnvSchema = baseEnv.extend({
  API_BASE_URL: httpUrl.default('http://localhost:4000'),
  API_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  WEB_APP_URL: httpUrl.default('http://localhost:3000'),
  AUTH_PROXY_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
});

export type ServerConfig = z.infer<typeof serverEnvSchema>;
export type WebConfig = z.infer<typeof webEnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function parse<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
): z.infer<S> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration: ${issues}`);
  }

  return result.data;
}

let envLoaded = false;

export function loadRootEnv(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  // Local commands run from an app or package directory; the repository owns one .env.
  try {
    loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
  } catch {
    // .env is optional in CI and deployed environments.
  }
}

export function parseServerConfig(source: Record<string, string | undefined>): ServerConfig {
  return parse(serverEnvSchema, source);
}

export function loadServerConfig(source: NodeJS.ProcessEnv = process.env): ServerConfig {
  loadRootEnv();
  return parse(serverEnvSchema, source);
}

export function parseWebConfig(source: Record<string, string | undefined>): WebConfig {
  return parse(webEnvSchema, source);
}

export function loadWebConfig(source: NodeJS.ProcessEnv = process.env): WebConfig {
  loadRootEnv();
  return parse(webEnvSchema, source);
}
