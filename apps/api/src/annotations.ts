import type { AnnotationService, AuthService } from '@oln/application';
import { AppError } from '@oln/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const noteParams = z.object({ id: z.uuid(), noteId: z.uuid() });
const annotationParams = z.object({
  id: z.uuid(),
  noteId: z.uuid(),
  annotationId: z.uuid(),
});
const listQuery = z.object({ revisionId: z.uuid().optional() });
const createBody = z.object({
  revisionId: z.uuid(),
  kind: z.enum(['comment', 'mark']),
  body: z.string().nullable().optional(),
  markType: z.string().min(1).max(100).optional(),
  anchor: z.unknown(),
});
const replyBody = z.object({ body: z.string() });
const updateBody = z.object({ body: z.string() });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('The request is invalid.', { status: 400, title: 'Invalid request' });
  }
  return result.data;
}

async function currentUser(request: FastifyRequest, auth: AuthService) {
  return (await requireUser(request, auth)).user;
}

export function registerAnnotationRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: AnnotationService,
): void {
  app.get('/knowledge-bases/:id/notes/:noteId/annotations', async (request) => {
    const user = await currentUser(request, auth);
    const params = parse(noteParams, request.params);
    const query = parse(listQuery, request.query);
    return service.list(user, params.id, params.noteId, {
      currentRevisionId: query.revisionId,
    });
  });

  app.post('/knowledge-bases/:id/notes/:noteId/annotations', async (request, reply) => {
    const user = await currentUser(request, auth);
    const params = parse(noteParams, request.params);
    const body = parse(createBody, request.body);
    const annotation = await service.create(user, params.id, params.noteId, body);
    return reply.status(201).send(annotation);
  });

  app.post(
    '/knowledge-bases/:id/notes/:noteId/annotations/:annotationId/replies',
    async (request, reply) => {
      const user = await currentUser(request, auth);
      const params = parse(annotationParams, request.params);
      const body = parse(replyBody, request.body);
      const annotation = await service.reply(
        user,
        params.id,
        params.noteId,
        params.annotationId,
        body.body,
      );
      return reply.status(201).send(annotation);
    },
  );

  app.patch('/knowledge-bases/:id/notes/:noteId/annotations/:annotationId', async (request) => {
    const user = await currentUser(request, auth);
    const params = parse(annotationParams, request.params);
    const body = parse(updateBody, request.body);
    return service.update(user, params.id, params.noteId, params.annotationId, body.body);
  });

  app.delete(
    '/knowledge-bases/:id/notes/:noteId/annotations/:annotationId',
    async (request, reply) => {
      const user = await currentUser(request, auth);
      const params = parse(annotationParams, request.params);
      await service.remove(user, params.id, params.noteId, params.annotationId);
      return reply.status(204).send();
    },
  );
}
