import type { AuthService, KnowledgeBaseService } from '@oln/application';
import { AppError } from '@oln/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';

const idParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const invitationParams = z.object({ id: z.uuid(), invitationId: z.uuid() });
const joinLinkParams = z.object({ id: z.uuid(), joinLinkId: z.uuid() });
const transferParams = z.object({ id: z.uuid(), transferId: z.uuid() });
const transferOnlyParams = z.object({ transferId: z.uuid() });
const tokenParams = z.object({ token: z.string().min(1).max(500) });
const createBody = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
});
const updateBody = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
});
const roleBody = z.object({ role: z.enum(['manager', 'viewer']) });
const inviteBody = z.object({ email: z.email(), role: z.enum(['manager', 'viewer']) });
const joinLinkBody = z.object({
  role: z.enum(['manager', 'viewer']),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});
const transferBody = z.object({ toUserId: z.uuid() });

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

export function registerKnowledgeBaseRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: KnowledgeBaseService,
): void {
  app.get('/knowledge-bases', async (request) => {
    const user = await currentUser(request, auth);
    return service.list(user);
  });

  app.post('/knowledge-bases', async (request, reply) => {
    const user = await currentUser(request, auth);
    const body = parse(createBody, request.body);
    const knowledgeBase = await service.create(user, body);
    reply.status(201).send(knowledgeBase);
  });

  app.get('/knowledge-bases/:id', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.get(user, id);
  });

  app.patch('/knowledge-bases/:id', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.update(user, id, parse(updateBody, request.body));
  });

  app.get('/knowledge-bases/:id/members', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.listMembers(user, id);
  });

  app.patch('/knowledge-bases/:id/members/:userId', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id, userId } = parse(memberParams, request.params);
    const { role } = parse(roleBody, request.body);
    await service.changeRole(user, id, userId, role);
    reply.status(204).send();
  });

  app.delete('/knowledge-bases/:id/members/:userId', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id, userId } = parse(memberParams, request.params);
    await service.removeMember(user, id, userId);
    reply.status(204).send();
  });

  app.get('/knowledge-bases/:id/invitations', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.listInvitations(user, id);
  });

  app.post('/knowledge-bases/:id/invitations', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const invitation = await service.invite(user, id, parse(inviteBody, request.body));
    reply.status(201).send(invitation);
  });

  app.post('/knowledge-bases/:id/invitations/:invitationId/resend', async (request) => {
    const user = await currentUser(request, auth);
    const { id, invitationId } = parse(invitationParams, request.params);
    return service.resendInvitation(user, id, invitationId);
  });

  app.delete('/knowledge-bases/:id/invitations/:invitationId', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id, invitationId } = parse(invitationParams, request.params);
    await service.revokeInvitation(user, id, invitationId);
    reply.status(204).send();
  });

  app.get('/invitations/:token', async (request) => {
    const { token } = parse(tokenParams, request.params);
    return service.invitationPreview(token);
  });

  app.post('/invitations/:token/accept', async (request) => {
    const user = await currentUser(request, auth);
    const { token } = parse(tokenParams, request.params);
    return service.acceptInvitation(user, token);
  });

  app.get('/knowledge-bases/:id/join-links', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.listJoinLinks(user, id);
  });

  app.post('/knowledge-bases/:id/join-links', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const link = await service.createJoinLink(user, id, parse(joinLinkBody, request.body));
    reply.status(201).send(link);
  });

  app.delete('/knowledge-bases/:id/join-links/:joinLinkId', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id, joinLinkId } = parse(joinLinkParams, request.params);
    await service.revokeJoinLink(user, id, joinLinkId);
    reply.status(204).send();
  });

  app.get('/join-links/:token', async (request) => {
    const { token } = parse(tokenParams, request.params);
    return service.joinLinkPreview(token);
  });

  app.post('/join-links/:token/accept', async (request) => {
    const user = await currentUser(request, auth);
    const { token } = parse(tokenParams, request.params);
    return service.acceptJoinLink(user, token);
  });

  app.get('/knowledge-bases/:id/ownership-transfers', async (request) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    return service.pendingOwnershipTransfer(user, id);
  });

  app.post('/knowledge-bases/:id/ownership-transfers', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id } = parse(idParams, request.params);
    const { toUserId } = parse(transferBody, request.body);
    const transfer = await service.transferOwnership(user, id, toUserId);
    reply.status(201).send(transfer);
  });

  app.post('/ownership-transfers/:transferId/accept', async (request) => {
    const user = await currentUser(request, auth);
    const { transferId } = parse(transferOnlyParams, request.params);
    return service.acceptOwnershipTransfer(user, transferId);
  });

  app.delete('/knowledge-bases/:id/ownership-transfers/:transferId', async (request, reply) => {
    const user = await currentUser(request, auth);
    const { id, transferId } = parse(transferParams, request.params);
    await service.cancelOwnershipTransfer(user, id, transferId);
    reply.status(204).send();
  });
}
