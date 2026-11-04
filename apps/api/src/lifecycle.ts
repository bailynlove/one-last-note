import type { AuthService, LifecycleService } from '@oln/application';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const id = z.uuid();

export function registerLifecycleRoutes(
  app: FastifyInstance,
  auth: AuthService,
  lifecycle: LifecycleService,
): void {
  app.get('/knowledge-bases/deleted', async (request) => {
    const { user } = await requireUser(request, auth);
    return { knowledgeBases: await lifecycle.listDeletedKnowledgeBases(user.id) };
  });

  app.post('/knowledge-bases/:id/restore', async (request) => {
    const { user } = await requireUser(request, auth);
    const params = z.object({ id }).parse(request.params);
    return lifecycle.restoreKnowledgeBase(user.id, params.id);
  });

  app.get('/knowledge-bases/:id/trash', async (request) => {
    const { user } = await requireUser(request, auth);
    const params = z.object({ id }).parse(request.params);
    return { associations: await lifecycle.listAssociationTrash(user.id, params.id) };
  });

  app.delete('/knowledge-bases/:id', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const params = z.object({ id }).parse(request.params);
    await lifecycle.deleteKnowledgeBase(user.id, params.id);
    return reply.status(204).send();
  });

  app.delete('/knowledge-bases/:id/notes/:noteId/association', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const params = z.object({ id, noteId: id }).parse(request.params);
    await lifecycle.trashAssociation(user.id, params.noteId, params.id);
    return reply.status(204).send();
  });

  app.post('/knowledge-bases/:id/notes/:noteId/restore', async (request) => {
    const { user } = await requireUser(request, auth);
    const params = z.object({ id, noteId: id }).parse(request.params);
    return lifecycle.restoreAssociation(user.id, params.noteId, params.id);
  });
}
