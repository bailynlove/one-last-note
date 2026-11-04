import { randomBytes, randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import multipart from '@fastify/multipart';
import type {
  AgentControlService,
  AgentTokenService,
  AnnotationService,
  AppExtensionService,
  AuthService,
  CaptureService,
  ExtensionAuthService,
  KnowledgeBaseService,
  LifecycleService,
  NoteService,
  ReadinessChecker,
  RelationService,
} from '@oln/application';
import {
  AppError,
  QuotaExceededError,
  RateLimitError,
  UploadValidationError,
} from '@oln/application';
import {
  API_REQUEST_RATE_LIMIT,
  API_REQUEST_RATE_WINDOW_SECONDS,
  MAX_ORIGINAL_BYTES,
  type ReadinessReport,
  type ServiceHealth,
} from '@oln/domain';
import type { AgentRateLimiter, Metrics } from '@oln/infrastructure';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { registerAgentTokenRoutes } from './agent-tokens';
import { registerAnnotationRoutes } from './annotations';
import { registerAppExtensionRoutes } from './app-extensions';
import { registerAuthRoutes } from './auth';
import { registerCaptureRoutes } from './captures';
import { registerExtensionAuthRoutes } from './extension-auth';
import { registerKnowledgeBaseRoutes } from './knowledge-bases';
import { registerLifecycleRoutes } from './lifecycle';
import { registerMcpRoute } from './mcp';
import { registerMetricsRoute } from './metrics';
import { registerNoteRoutes } from './notes';
import { registerRelationRoutes } from './relations';

export interface BuildApiOptions {
  logger: FastifyBaseLogger;
  readiness: ReadinessChecker;
  auth?: AuthService;
  knowledgeBases?: KnowledgeBaseService;
  notes?: NoteService;
  relations?: RelationService;
  annotations?: AnnotationService;
  appExtensions?: AppExtensionService;
  lifecycle?: LifecycleService;
  captures?: CaptureService;
  extensionAuth?: ExtensionAuthService;
  agentTokens?: AgentTokenService;
  mcp?: { control: AgentControlService; limiter: AgentRateLimiter };
  metrics?: Metrics;
  metricsToken?: string;
  requestLimiter?: (
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  authProxySecret?: string;
  trustProxy?: number;
  now?: () => Date;
}

export function buildApi({
  logger,
  readiness,
  auth,
  knowledgeBases,
  notes,
  relations,
  annotations,
  appExtensions,
  lifecycle,
  captures,
  extensionAuth,
  agentTokens,
  mcp,
  metrics,
  metricsToken,
  requestLimiter,
  authProxySecret,
  trustProxy = 0,
  now = () => new Date(),
}: BuildApiOptions): FastifyInstance {
  const startedAt = Date.now();
  const starts = new Map<string, number>();
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: trustProxy > 0 ? (_address, hop) => hop < trustProxy : false,
  });

  app.addHook('onRequest', async (request, reply) => {
    if (requestLimiter) {
      const limit = await requestLimiter(
        `api:${request.ip}`,
        API_REQUEST_RATE_LIMIT,
        API_REQUEST_RATE_WINDOW_SECONDS,
      );
      if (!limit.allowed) {
        return reply
          .code(429)
          .header('retry-after', String(limit.retryAfterSeconds))
          .send({ type: 'about:blank', title: 'Too Many Requests', status: 429 });
      }
    }
    starts.set(request.id, performance.now());
    const incoming = request.headers.traceparent;
    const traceId =
      typeof incoming === 'string' && /^[0-9a-f]{2}-[0-9a-f]{32}-/.test(incoming)
        ? incoming.split('-')[1]
        : randomBytes(16).toString('hex');
    request.headers['x-trace-id'] = traceId;
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-request-id', reply.request.id);
    reply.header('x-trace-id', String(reply.request.headers['x-trace-id'] ?? ''));
    reply.header('cache-control', 'no-store');
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!metrics) return;
    const start = starts.get(request.id);
    starts.delete(request.id);
    const route = request.routeOptions.url ?? 'unknown';
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    metrics.inc('api_requests_total', labels);
    if (start !== undefined) {
      metrics.observe('api_request_duration_seconds', labels, (performance.now() - start) / 1000);
    }
  });

  app.get(
    '/health',
    async (): Promise<ServiceHealth> => ({
      status: 'ok',
      service: 'api',
      uptimeSeconds: Math.floor((now().getTime() - startedAt) / 1000),
    }),
  );

  app.get('/ready', async (request, reply): Promise<ReadinessReport> => {
    const report = await readiness.execute();
    reply.status(report.status === 'ok' ? 200 : 503);
    request.log.info({ readiness: report }, 'readiness checked');
    return report;
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .type('application/problem+json')
      .send({
        type: 'https://one-last-note.dev/problems/404',
        title: 'Not Found',
        status: 404,
        detail: `Route ${request.method} ${request.url} does not exist.`,
        instance: request.url,
      });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof UploadValidationError || error instanceof QuotaExceededError) {
      const status = error instanceof QuotaExceededError ? 413 : 422;
      request.log.warn({ err: error }, 'upload rejected');
      reply
        .status(status)
        .type('application/problem+json')
        .send({
          type: `https://one-last-note.dev/problems/${status}`,
          title: error instanceof QuotaExceededError ? 'Storage quota exceeded' : 'Upload rejected',
          status,
          detail: error.message,
          code: error.code,
          instance: request.url,
        });
      return;
    }

    const status = error instanceof AppError ? error.status : (error.statusCode ?? 500);
    const clientSafe = status < 500;
    const title =
      error instanceof AppError
        ? error.title
        : (STATUS_CODES[status] ?? (clientSafe ? 'Request Error' : 'Internal Server Error'));

    if (error instanceof RateLimitError) {
      reply.header('retry-after', String(error.retryAfterSeconds));
    }
    if (status === 401) {
      reply.header('www-authenticate', 'Bearer');
    }

    if (clientSafe) {
      request.log.warn({ err: error }, 'request rejected');
    } else {
      request.log.error({ err: error }, 'request failed');
    }

    reply
      .status(status)
      .type('application/problem+json')
      .send({
        type: `https://one-last-note.dev/problems/${status}`,
        title,
        status,
        detail: clientSafe ? error.message : 'An unexpected error occurred.',
        instance: request.url,
      });
  });

  if (auth) {
    registerAuthRoutes(app, auth, authProxySecret);
  }
  if (auth && knowledgeBases) {
    registerKnowledgeBaseRoutes(app, auth, knowledgeBases);
  }
  if (auth && lifecycle) {
    registerLifecycleRoutes(app, auth, lifecycle);
  }
  if (auth && notes) {
    app.register(multipart, { limits: { fileSize: MAX_ORIGINAL_BYTES, files: 1 } });
    registerNoteRoutes(app, auth, notes);
  }
  if (auth && relations) {
    registerRelationRoutes(app, auth, relations);
  }
  if (auth && annotations) {
    registerAnnotationRoutes(app, auth, annotations);
  }
  if (auth && appExtensions) {
    registerAppExtensionRoutes(app, auth, appExtensions);
  }
  if (auth && captures) {
    registerCaptureRoutes(app, auth, captures);
  }
  if (auth && extensionAuth) {
    registerExtensionAuthRoutes(app, auth, extensionAuth, authProxySecret);
  }
  if (auth && agentTokens) {
    registerAgentTokenRoutes(app, auth, agentTokens);
  }
  if (mcp) {
    registerMcpRoute(app, { tokens: agentTokens as AgentTokenService, ...mcp });
  }

  if (metrics) registerMetricsRoute(app, metrics, metricsToken);

  return app;
}
