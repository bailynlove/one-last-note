import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import multipart from '@fastify/multipart';
import type {
  AnnotationService,
  AuthService,
  CaptureService,
  ExtensionAuthService,
  KnowledgeBaseService,
  LifecycleService,
  NoteService,
  ReadinessChecker,
} from '@oln/application';
import {
  AppError,
  AuthThrottleError,
  QuotaExceededError,
  UploadValidationError,
} from '@oln/application';
import { MAX_ORIGINAL_BYTES, type ReadinessReport, type ServiceHealth } from '@oln/domain';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { registerAnnotationRoutes } from './annotations';
import { registerAuthRoutes } from './auth';
import { registerCaptureRoutes } from './captures';
import { registerExtensionAuthRoutes } from './extension-auth';
import { registerKnowledgeBaseRoutes } from './knowledge-bases';
import { registerLifecycleRoutes } from './lifecycle';
import { registerNoteRoutes } from './notes';

export interface BuildApiOptions {
  logger: FastifyBaseLogger;
  readiness: ReadinessChecker;
  auth?: AuthService;
  knowledgeBases?: KnowledgeBaseService;
  notes?: NoteService;
  annotations?: AnnotationService;
  lifecycle?: LifecycleService;
  captures?: CaptureService;
  extensionAuth?: ExtensionAuthService;
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
  annotations,
  lifecycle,
  captures,
  extensionAuth,
  authProxySecret,
  trustProxy = 0,
  now = () => new Date(),
}: BuildApiOptions): FastifyInstance {
  const startedAt = Date.now();
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: trustProxy > 0 ? (_address, hop) => hop < trustProxy : false,
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-request-id', reply.request.id);
    reply.header('cache-control', 'no-store');
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

    if (error instanceof AuthThrottleError) {
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
  if (auth && annotations) {
    registerAnnotationRoutes(app, auth, annotations);
  }
  if (auth && captures) {
    registerCaptureRoutes(app, auth, captures);
  }
  if (auth && extensionAuth) {
    registerExtensionAuthRoutes(app, auth, extensionAuth, authProxySecret);
  }

  return app;
}
