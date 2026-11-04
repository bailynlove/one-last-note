import { randomUUID } from 'node:crypto';
import { AuthService, createToken, hashToken, KnowledgeBaseService } from '@oln/application';
import { createAuthStore, createAuthThrottle, createKnowledgeBaseStore } from '@oln/infrastructure';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  joinLinks,
  knowledgeBaseInvitations,
  knowledgeBaseMemberships,
  ownershipTransfers,
  sessions,
  users,
} from '../packages/infrastructure/src/db/schema';
import { startTestApi, startTestStack, type TestStack, testReadiness } from './fixtures';

let stack: TestStack;
let app: FastifyInstance;
const emails: { to: string; knowledgeBaseName: string; role: string; url: string }[] = [];
let failNextInvitation = false;

beforeAll(async () => {
  stack = await startTestStack();
  const auth = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  const knowledgeBases = new KnowledgeBaseService({
    store: createKnowledgeBaseStore(stack.database),
    email: {
      async sendInvitation(message) {
        if (failNextInvitation) {
          failNextInvitation = false;
          throw new Error('mail unavailable');
        }
        emails.push(message);
      },
    },
    webAppUrl: 'http://localhost:3000',
  });
  app = startTestApi(testReadiness(stack), { auth, knowledgeBases });
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

async function createUser(label: string): Promise<{ id: string; email: string; token: string }> {
  const email = `${label}-${randomUUID()}@example.com`;
  const [user] = await stack.database.db
    .insert(users)
    .values({
      email,
      displayName: label,
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) {
    throw new Error('user insert failed');
  }
  const token = createToken();
  await stack.database.db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastSeenAt: new Date(),
  });
  return { id: user.id, email, token };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createKnowledgeBase(token: string, name = 'Research') {
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge-bases',
    headers: auth(token),
    payload: { name, description: 'A place for sources' },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}

async function invite(ownerToken: string, id: string, email: string, role: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/knowledge-bases/${id}/invitations`,
    headers: auth(ownerToken),
    payload: { email, role },
  });
  expect(response.statusCode).toBe(201);
  const message = emails.at(-1);
  if (!message) {
    throw new Error('no invitation email captured');
  }
  const token = new URL(message.url).pathname.split('/').at(-1);
  if (!token) {
    throw new Error('invitation URL has no token');
  }
  return token;
}

describe('Knowledge Base membership with real storage', () => {
  it('creates a Knowledge Base and enforces membership and roles', async () => {
    const owner = await createUser('owner');
    const manager = await createUser('manager');
    const viewer = await createUser('viewer');
    const outsider = await createUser('outsider');

    const knowledgeBase = await createKnowledgeBase(owner.token);

    const access = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(owner.token),
    });
    expect(access.statusCode).toBe(200);
    expect(access.json()).toMatchObject({ knowledgeBase: { name: 'Research' }, role: 'owner' });

    const hidden = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(outsider.token),
    });
    expect(hidden.statusCode).toBe(404);

    const managerToken = await invite(owner.token, knowledgeBase.id, manager.email, 'manager');
    const accepted = await app.inject({
      method: 'POST',
      url: `/invitations/${managerToken}/accept`,
      headers: auth(manager.token),
    });
    expect(accepted.statusCode).toBe(200);

    const managerInvite = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations`,
      headers: auth(manager.token),
      payload: { email: viewer.email, role: 'manager' },
    });
    expect(managerInvite.statusCode).toBe(403);

    const viewerToken = await invite(manager.token, knowledgeBase.id, viewer.email, 'viewer');
    const viewerAccepted = await app.inject({
      method: 'POST',
      url: `/invitations/${viewerToken}/accept`,
      headers: auth(viewer.token),
    });
    expect(viewerAccepted.statusCode).toBe(200);

    const viewerInvite = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations`,
      headers: auth(viewer.token),
      payload: { email: outsider.email, role: 'viewer' },
    });
    expect(viewerInvite.statusCode).toBe(403);

    const managerChangesRole = await app.inject({
      method: 'PATCH',
      url: `/knowledge-bases/${knowledgeBase.id}/members/${viewer.id}`,
      headers: auth(manager.token),
      payload: { role: 'manager' },
    });
    expect(managerChangesRole.statusCode).toBe(403);

    const ownerChangesRole = await app.inject({
      method: 'PATCH',
      url: `/knowledge-bases/${knowledgeBase.id}/members/${viewer.id}`,
      headers: auth(owner.token),
      payload: { role: 'manager' },
    });
    expect(ownerChangesRole.statusCode).toBe(204);

    const members = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/members`,
      headers: auth(owner.token),
    });
    expect(members.statusCode).toBe(200);
    const roles = (members.json() as { role: string }[]).map((member) => member.role).sort();
    expect(roles).toEqual(['manager', 'manager', 'owner']);

    const leave = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/members/${owner.id}`,
      headers: auth(owner.token),
    });
    expect(leave.statusCode).toBe(409);

    const removeByManager = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/members/${viewer.id}`,
      headers: auth(manager.token),
    });
    expect(removeByManager.statusCode).toBe(403);

    const removeByOwner = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/members/${viewer.id}`,
      headers: auth(owner.token),
    });
    expect(removeByOwner.statusCode).toBe(204);
  });

  it('handles invitation replay, expiry, wrong email, and join-link revocation', async () => {
    const owner = await createUser('owner2');
    const invited = await createUser('invited');
    const wrong = await createUser('wrong');
    const joiner = await createUser('joiner');
    const late = await createUser('late');

    const knowledgeBase = await createKnowledgeBase(owner.token, 'Invites');

    const wrongToken = await invite(owner.token, knowledgeBase.id, invited.email, 'viewer');
    const rejected = await app.inject({
      method: 'POST',
      url: `/invitations/${wrongToken}/accept`,
      headers: auth(wrong.token),
    });
    expect(rejected.statusCode).toBe(403);

    const accepted = await app.inject({
      method: 'POST',
      url: `/invitations/${wrongToken}/accept`,
      headers: auth(invited.token),
    });
    expect(accepted.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: `/invitations/${wrongToken}/accept`,
      headers: auth(invited.token),
    });
    expect(replay.statusCode).toBe(400);

    const expiredToken = await invite(owner.token, knowledgeBase.id, late.email, 'viewer');
    await stack.database.db
      .update(knowledgeBaseInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(knowledgeBaseInvitations.tokenHash, hashToken(expiredToken)));
    const expired = await app.inject({
      method: 'POST',
      url: `/invitations/${expiredToken}/accept`,
      headers: auth(late.token),
    });
    expect(expired.statusCode).toBe(400);

    const linkResponse = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/join-links`,
      headers: auth(owner.token),
      payload: { role: 'viewer', expiresInDays: 7 },
    });
    expect(linkResponse.statusCode).toBe(201);
    const link = linkResponse.json() as { id: string; token: string };

    const preview = await app.inject({ method: 'GET', url: `/join-links/${link.token}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ knowledgeBaseName: 'Invites', role: 'viewer' });

    const joined = await app.inject({
      method: 'POST',
      url: `/join-links/${link.token}/accept`,
      headers: auth(joiner.token),
    });
    expect(joined.statusCode).toBe(200);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/join-links/${link.id}`,
      headers: auth(owner.token),
    });
    expect(revoked.statusCode).toBe(204);

    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/join-links/${link.token}`,
    });
    expect(afterRevoke.statusCode).toBe(404);

    const managerLink = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/join-links`,
      headers: auth(invited.token),
      payload: { role: 'viewer' },
    });
    expect(managerLink.statusCode).toBe(403);

    const expiring = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/join-links`,
      headers: auth(owner.token),
      payload: { role: 'viewer' },
    });
    const expiringLink = expiring.json() as { id: string; token: string };
    await stack.database.db
      .update(joinLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(joinLinks.id, expiringLink.id));
    const expiredLink = await app.inject({
      method: 'GET',
      url: `/join-links/${expiringLink.token}`,
    });
    expect(expiredLink.statusCode).toBe(404);
  });

  it('transfers ownership only after the Manager accepts', async () => {
    const owner = await createUser('owner3');
    const manager = await createUser('manager3');
    const knowledgeBase = await createKnowledgeBase(owner.token, 'Transfer');

    const invitationToken = await invite(owner.token, knowledgeBase.id, manager.email, 'manager');
    await app.inject({
      method: 'POST',
      url: `/invitations/${invitationToken}/accept`,
      headers: auth(manager.token),
    });

    const transfer = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: manager.id },
    });
    expect(transfer.statusCode).toBe(201);
    const { id: transferId } = transfer.json() as { id: string };

    const before = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(owner.token),
    });
    expect(before.json()).toMatchObject({ role: 'owner' });

    const wrongUser = await app.inject({
      method: 'POST',
      url: `/ownership-transfers/${transferId}/accept`,
      headers: auth(owner.token),
    });
    expect(wrongUser.statusCode).toBe(404);

    const accepted = await app.inject({
      method: 'POST',
      url: `/ownership-transfers/${transferId}/accept`,
      headers: auth(manager.token),
    });
    expect(accepted.statusCode).toBe(200);

    const afterOwner = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(owner.token),
    });
    expect(afterOwner.json()).toMatchObject({ role: 'manager' });

    const afterManager = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(manager.token),
    });
    expect(afterManager.json()).toMatchObject({ role: 'owner' });

    const members = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/members`,
      headers: auth(manager.token),
    });
    expect(
      (members.json() as { role: string }[]).filter((member) => member.role === 'owner'),
    ).toHaveLength(1);
  });

  it('does not demote the Owner when the transfer target is gone', async () => {
    const owner = await createUser('owner4');
    const manager = await createUser('manager4');
    const knowledgeBase = await createKnowledgeBase(owner.token, 'Broken transfer');

    const invitationToken = await invite(owner.token, knowledgeBase.id, manager.email, 'manager');
    await app.inject({
      method: 'POST',
      url: `/invitations/${invitationToken}/accept`,
      headers: auth(manager.token),
    });

    const transfer = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: manager.id },
    });
    expect(transfer.statusCode).toBe(201);
    const { id: transferId } = transfer.json() as { id: string };

    await stack.database.db
      .delete(knowledgeBaseMemberships)
      .where(
        and(
          eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBase.id),
          eq(knowledgeBaseMemberships.userId, manager.id),
        ),
      );

    const accepted = await app.inject({
      method: 'POST',
      url: `/ownership-transfers/${transferId}/accept`,
      headers: auth(manager.token),
    });
    expect(accepted.statusCode).toBe(404);

    const access = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(owner.token),
    });
    expect(access.json()).toMatchObject({ role: 'owner' });
  });

  it('recovers from email failure on invite and resend without killing old links', async () => {
    const owner = await createUser('owner5');
    const invited = await createUser('invited5');
    const knowledgeBase = await createKnowledgeBase(owner.token, 'Mail failure');

    failNextInvitation = true;
    const failed = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations`,
      headers: auth(owner.token),
      payload: { email: invited.email, role: 'viewer' },
    });
    expect(failed.statusCode).toBe(503);

    const retried = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations`,
      headers: auth(owner.token),
      payload: { email: invited.email, role: 'viewer' },
    });
    expect(retried.statusCode).toBe(201);
    const firstToken = new URL(emails.at(-1)?.url ?? '').pathname.split('/').at(-1);
    expect(firstToken).toBeTruthy();

    failNextInvitation = true;
    const resendFailed = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations/${retried.json().id}/resend`,
      headers: auth(owner.token),
    });
    expect(resendFailed.statusCode).toBe(503);

    const stillValid = await app.inject({
      method: 'GET',
      url: `/invitations/${firstToken}`,
    });
    expect(stillValid.statusCode).toBe(200);

    const resend = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations/${retried.json().id}/resend`,
      headers: auth(owner.token),
    });
    expect(resend.statusCode).toBe(200);
    const secondToken = new URL(emails.at(-1)?.url ?? '').pathname.split('/').at(-1);
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);

    const oldLink = await app.inject({ method: 'GET', url: `/invitations/${firstToken}` });
    expect(oldLink.statusCode).toBe(404);
    const newLink = await app.inject({ method: 'GET', url: `/invitations/${secondToken}` });
    expect(newLink.statusCode).toBe(200);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/invitations/${retried.json().id}`,
      headers: auth(owner.token),
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/invitations/${secondToken}`,
    });
    expect(afterRevoke.statusCode).toBe(404);
  });

  it('upgrades an existing Viewer when they accept a Manager invitation', async () => {
    const owner = await createUser('owner6');
    const person = await createUser('person6');
    const knowledgeBase = await createKnowledgeBase(owner.token, 'Upgrade');

    const managerToken = await invite(owner.token, knowledgeBase.id, person.email, 'manager');
    const linkResponse = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/join-links`,
      headers: auth(owner.token),
      payload: { role: 'viewer' },
    });
    const link = linkResponse.json() as { token: string };
    const joined = await app.inject({
      method: 'POST',
      url: `/join-links/${link.token}/accept`,
      headers: auth(person.token),
    });
    expect(joined.statusCode).toBe(200);

    const accepted = await app.inject({
      method: 'POST',
      url: `/invitations/${managerToken}/accept`,
      headers: auth(person.token),
    });
    expect(accepted.statusCode).toBe(200);

    const access = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}`,
      headers: auth(person.token),
    });
    expect(access.json()).toMatchObject({ role: 'manager' });
  });

  it('handles a concurrent invitation replay and transfer cancellation', async () => {
    const owner = await createUser('owner7');
    const invited = await createUser('invited7');
    const manager = await createUser('manager7');
    const viewer = await createUser('viewer7');
    const knowledgeBase = await createKnowledgeBase(owner.token, 'Races');

    const token = await invite(owner.token, knowledgeBase.id, invited.email, 'viewer');
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        headers: auth(invited.token),
      }),
      app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        headers: auth(invited.token),
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 400]);

    const managerToken = await invite(owner.token, knowledgeBase.id, manager.email, 'manager');
    await app.inject({
      method: 'POST',
      url: `/invitations/${managerToken}/accept`,
      headers: auth(manager.token),
    });
    const viewerToken = await invite(owner.token, knowledgeBase.id, viewer.email, 'viewer');
    await app.inject({
      method: 'POST',
      url: `/invitations/${viewerToken}/accept`,
      headers: auth(viewer.token),
    });

    const selfTarget = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: owner.id },
    });
    expect(selfTarget.statusCode).toBe(409);

    const viewerTarget = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: viewer.id },
    });
    expect(viewerTarget.statusCode).toBe(409);

    const firstTransfer = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: manager.id },
    });
    const firstId = (firstTransfer.json() as { id: string }).id;
    const secondTransfer = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: manager.id },
    });
    const secondId = (secondTransfer.json() as { id: string }).id;
    expect(secondId).not.toBe(firstId);

    const pending = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
    });
    expect(pending.json()).toMatchObject({ id: secondId, toUserId: manager.id });

    const superseded = await app.inject({
      method: 'POST',
      url: `/ownership-transfers/${firstId}/accept`,
      headers: auth(manager.token),
    });
    expect(superseded.statusCode).toBe(404);

    const expiredTransfer = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: manager.id },
    });
    const expiredTransferId = (expiredTransfer.json() as { id: string }).id;
    await stack.database.db
      .update(ownershipTransfers)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ownershipTransfers.id, expiredTransferId));
    const expiredAccept = await app.inject({
      method: 'POST',
      url: `/ownership-transfers/${expiredTransferId}/accept`,
      headers: auth(manager.token),
    });
    expect(expiredAccept.statusCode).toBe(400);

    const cancelTarget = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers`,
      headers: auth(owner.token),
      payload: { toUserId: manager.id },
    });
    const cancelTargetId = (cancelTarget.json() as { id: string }).id;
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers/${cancelTargetId}`,
      headers: auth(owner.token),
    });
    expect(cancelled.statusCode).toBe(204);
    const afterCancel = await app.inject({
      method: 'POST',
      url: `/ownership-transfers/${cancelTargetId}/accept`,
      headers: auth(manager.token),
    });
    expect(afterCancel.statusCode).toBe(404);
    const cancelAgain = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/ownership-transfers/${cancelTargetId}`,
      headers: auth(owner.token),
    });
    expect(cancelAgain.statusCode).toBe(404);
  });

  it('requires authentication for workspace routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/knowledge-bases' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const mutation = await app.inject({
      method: 'POST',
      url: '/knowledge-bases',
      payload: { name: 'Unauthorized' },
    });
    expect(mutation.statusCode).toBe(401);
  });
});
