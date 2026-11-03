import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import type { ReadinessChecker } from '@oln/application';
import { AppError } from '@oln/application';
import type { ReadinessReport, ServiceHealth } from '@oln/domain';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';

export interface BuildApiOptions {
  logger: FastifyBaseLogger;
  readiness: ReadinessChecker;
  now?: () => Date;
}

export function buildApi({
  logger,
  readiness,
  now = () => new Date(),
}: BuildApiOptions): FastifyInstance {
  const startedAt = Date.now();
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
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
    const status = error instanceof AppError ? error.status : (error.statusCode ?? 500);
    const clientSafe = status < 500;
    const title =
      error instanceof AppError
        ? error.title
        : (STATUS_CODES[status] ?? (clientSafe ? 'Request Error' : 'Internal Server Error'));

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

  return app;
}
