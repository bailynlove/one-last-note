import type { AgentTokenService, AuthService } from '@oln/application';
import { AGENT_SCOPES, type AgentTokenScope } from '@oln/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1).max(2).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export function registerAgentTokenRoutes(
  app: FastifyInstance,
  auth: AuthService,
  tokens: AgentTokenService,
): void {
  app.get('/agent-tokens', async (request) => {
    const { user } = await requireUser(request, auth);
    return { tokens: await tokens.list(user) };
  });

  app.post('/agent-tokens', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const body = createSchema.parse(request.body ?? {});
    const result = await tokens.create(user, {
      name: body.name,
      ...(body.scopes ? { scopes: body.scopes as AgentTokenScope[] } : {}),
      ...(body.expiresInDays ? { expiresInDays: body.expiresInDays } : {}),
    });
    return reply.code(201).send({ token: result.token, agentToken: result.summary });
  });

  app.delete('/agent-tokens/:id', async (request, reply) => {
    const { user } = await requireUser(request, auth);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await tokens.revoke(user, id);
    return reply.code(204).send();
  });
}
