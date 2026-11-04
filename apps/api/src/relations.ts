import type { AuthService, RelationService } from '@oln/application';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const uuid = z.uuid();

const createSchema = z.object({
  sourceNoteId: z.uuid(),
  targetNoteId: z.uuid(),
  type: z.enum(['related', 'references', 'supersedes']),
});

const graphQuerySchema = z.object({
  revision: z.string().max(100).optional(),
  type: z.string().max(40).optional(),
  origin: z.enum(['manual', 'content']).optional(),
  q: z.string().max(200).optional(),
});

export function registerRelationRoutes(
  app: FastifyInstance,
  auth: AuthService,
  relations: RelationService,
): void {
  app.get('/knowledge-bases/:id/relations', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id: knowledgeBaseId } = z.object({ id: uuid }).parse(request.params);
    const query = graphQuerySchema.parse(request.query);
    const graph = await relations.graph(user.id, knowledgeBaseId, {
      revision: query.revision,
      type: query.type,
      origin: query.origin,
      query: query.q,
    });
    reply.header('cache-control', 'no-store');
    return graph;
  });

  app.post('/knowledge-bases/:id/relations', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id: knowledgeBaseId } = z.object({ id: uuid }).parse(request.params);
    const body = createSchema.parse(request.body);
    const relation = await relations.create(user.id, knowledgeBaseId, body);
    return reply.code(201).send({ relation });
  });

  app.delete('/knowledge-bases/:id/relations/:relationId', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id: knowledgeBaseId, relationId } = z
      .object({ id: uuid, relationId: uuid })
      .parse(request.params);
    await relations.remove(user.id, knowledgeBaseId, relationId);
    return reply.code(204).send();
  });
}
