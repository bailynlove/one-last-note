import {
  AppError,
  CaptureLimitError,
  type CaptureService,
  type CreateCaptureInput,
} from '@oln/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const createBody = z.object({
  url: z.string().trim().min(1).max(2048),
  selectionHtml: z.string().max(1_000_000).nullish(),
  selectionText: z.string().max(1_000_000).nullish(),
  idempotencyKey: z.string().trim().min(1).max(200).nullish(),
});

const idParams = z.object({ id: z.uuid() });
const mediaParams = z.object({
  attemptId: z.uuid(),
  filename: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}$/i),
});

export function registerCaptureRoutes(
  app: FastifyInstance,
  auth: Parameters<typeof requireUser>[1],
  captures: CaptureService,
): void {
  app.post('/knowledge-bases/:id/captures', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id } = idParams.parse(request.params);
    const body = createBody.parse(request.body);
    const headerKey = request.headers['idempotency-key'];
    const input: CreateCaptureInput = {
      url: body.url,
      selectionHtml: body.selectionHtml,
      selectionText: body.selectionText,
      idempotencyKey: body.idempotencyKey ?? (typeof headerKey === 'string' ? headerKey : null),
    };
    try {
      const result = await captures.create(user.id, id, input);
      reply.status(202).send(result);
    } catch (error) {
      if (error instanceof CaptureLimitError) {
        throw new AppError(
          error.reason === 'rate'
            ? 'Too many captures. Try again later.'
            : 'Two captures are already in progress.',
          { status: 429, title: 'Capture limit reached' },
        );
      }
      throw error;
    }
  });

  app.get('/captures/:id', async (request) => {
    const { user } = await requireUser(request, auth);
    const { id } = idParams.parse(request.params);
    return captures.get(user.id, id);
  });

  app.post('/captures/:id/retry', async (request) => {
    const { user } = await requireUser(request, auth);
    const { id } = idParams.parse(request.params);
    return captures.retry(user.id, id);
  });

  app.get('/capture-media/:attemptId/:filename', async (request: FastifyRequest, reply) => {
    const { user } = await requireUser(request, auth);
    const { attemptId, filename } = mediaParams.parse(request.params);
    const media = await captures.readMedia(user.id, attemptId, filename);
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('x-content-type-options', 'nosniff');
    reply.type(media.contentType).send(Buffer.from(media.bytes));
  });
}
