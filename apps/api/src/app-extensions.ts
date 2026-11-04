import { type AppExtensionService, type AuthService, markTypesFor } from '@oln/application';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const uuid = z.uuid();

const installSchema = z.object({
  manifest: z.unknown(),
  files: z.record(z.string(), z.string()),
  source: z.string().max(300).optional(),
});

const toggleSchema = z.object({ enabled: z.boolean() });

export function registerAppExtensionRoutes(
  app: FastifyInstance,
  auth: AuthService,
  extensions: AppExtensionService,
): void {
  app.get('/knowledge-bases/:id/mark-types', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id } = z.object({ id: uuid }).parse(request.params);
    reply.header('cache-control', 'no-store');
    return { markTypes: markTypesFor(await extensions.markTypes(user.id, id)) };
  });

  app.get('/knowledge-bases/:id/extensions', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const installations = await extensions.list(user.id, id);
    reply.header('cache-control', 'no-store');
    return { installations };
  });

  app.post(
    '/knowledge-bases/:id/extensions',
    { bodyLimit: 3 * 1024 * 1024 },
    async (request, reply) => {
      const { user } = await requireUser(request, auth);
      const { id } = z.object({ id: uuid }).parse(request.params);
      const body = installSchema.parse(request.body);
      const installation = await extensions.install(user.id, id, body);
      return reply.code(201).send({ installation });
    },
  );

  app.patch('/knowledge-bases/:id/extensions/:installationId', async (request) => {
    const { user } = await requireUser(request, auth);
    const { id, installationId } = z
      .object({ id: uuid, installationId: uuid })
      .parse(request.params);
    const { enabled } = toggleSchema.parse(request.body);
    const installation = await extensions.setEnabled(user.id, id, installationId, enabled);
    return { installation };
  });

  app.delete('/knowledge-bases/:id/extensions/:installationId', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id, installationId } = z
      .object({ id: uuid, installationId: uuid })
      .parse(request.params);
    await extensions.remove(user.id, id, installationId);
    return reply.code(204).send();
  });
}
