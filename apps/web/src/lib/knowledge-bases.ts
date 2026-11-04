import { loadWebConfig } from '@oln/config';
import type { JoinLink, KnowledgeBase, KnowledgeBaseRole, Member } from '@oln/domain';
import { z } from 'zod';

const roleSchema = z.enum(['owner', 'manager', 'viewer']);
const invitableRoleSchema = z.enum(['manager', 'viewer']);
const knowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const summarySchema = knowledgeBaseSchema.extend({ role: roleSchema });
const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: roleSchema,
  joinedAt: z.string(),
});
const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: invitableRoleSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
});
const joinLinkSchema = z.object({
  id: z.string(),
  role: invitableRoleSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  token: z.string().optional(),
});
const invitationPreviewSchema = z.object({
  knowledgeBaseName: z.string(),
  role: invitableRoleSchema,
  email: z.string(),
  expiresAt: z.string(),
});
const joinLinkPreviewSchema = z.object({
  knowledgeBaseName: z.string(),
  role: invitableRoleSchema,
  expiresAt: z.string(),
});
const transferSchema = z.object({
  id: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type KnowledgeBaseAccess = KnowledgeBase & { role: KnowledgeBaseRole };
export type CreatedJoinLink = JoinLink & { token: string };

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; detail: string };

async function api<T>(
  schema: z.ZodType<T>,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const config = loadWebConfig();
  try {
    const response = await fetch(new URL(path, config.API_BASE_URL), {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(config.API_REQUEST_TIMEOUT_MS),
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      let detail = 'The request could not be completed.';
      try {
        const problem: unknown = await response.json();
        if (
          typeof problem === 'object' &&
          problem !== null &&
          'detail' in problem &&
          typeof problem.detail === 'string'
        ) {
          detail = problem.detail;
        }
      } catch {
        // Keep the generic message for non-JSON failures.
      }
      return { ok: false, status: response.status, detail };
    }
    if (response.status === 204) {
      return { ok: true, status: 204, data: schema.parse(undefined) };
    }
    return { ok: true, status: response.status, data: schema.parse(await response.json()) };
  } catch {
    return { ok: false, status: 0, detail: 'The API is unavailable.' };
  }
}

const emptySchema = z.undefined();
const listSchema = z.array(summarySchema);
const membersSchema = z.array(memberSchema);
const invitationsSchema = z.array(invitationSchema);
const joinLinksSchema = z.array(joinLinkSchema);

export function listKnowledgeBases(token: string) {
  return api(listSchema, '/knowledge-bases', token);
}

export function createKnowledgeBase(
  token: string,
  input: { name: string; description?: string | null },
) {
  return api(knowledgeBaseSchema, '/knowledge-bases', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getKnowledgeBase(token: string, id: string) {
  return api(
    z.object({ knowledgeBase: knowledgeBaseSchema, role: roleSchema }).transform((value) => ({
      ...value.knowledgeBase,
      role: value.role,
    })),
    `/knowledge-bases/${id}`,
    token,
  );
}

export function updateKnowledgeBase(
  token: string,
  id: string,
  input: { name?: string; description?: string | null },
) {
  return api(knowledgeBaseSchema, `/knowledge-bases/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listMembers(token: string, id: string) {
  return api(membersSchema, `/knowledge-bases/${id}/members`, token);
}

export function listInvitations(token: string, id: string) {
  return api(invitationsSchema, `/knowledge-bases/${id}/invitations`, token);
}

export function invite(
  token: string,
  id: string,
  input: { email: string; role: 'manager' | 'viewer' },
) {
  return api(invitationSchema, `/knowledge-bases/${id}/invitations`, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function resendInvitation(token: string, id: string, invitationId: string) {
  return api(invitationSchema, `/knowledge-bases/${id}/invitations/${invitationId}/resend`, token, {
    method: 'POST',
  });
}

export function revokeInvitation(token: string, id: string, invitationId: string) {
  return api(emptySchema, `/knowledge-bases/${id}/invitations/${invitationId}`, token, {
    method: 'DELETE',
  });
}

export function listJoinLinks(token: string, id: string) {
  return api(joinLinksSchema, `/knowledge-bases/${id}/join-links`, token);
}

export function createJoinLink(
  token: string,
  id: string,
  input: { role: 'manager' | 'viewer'; expiresInDays: number },
) {
  return api(
    joinLinkSchema.extend({ token: z.string() }),
    `/knowledge-bases/${id}/join-links`,
    token,
    { method: 'POST', body: JSON.stringify(input) },
  ) as Promise<ApiResult<CreatedJoinLink>>;
}

export function revokeJoinLink(token: string, id: string, joinLinkId: string) {
  return api(emptySchema, `/knowledge-bases/${id}/join-links/${joinLinkId}`, token, {
    method: 'DELETE',
  });
}

export function changeRole(token: string, id: string, userId: string, role: 'manager' | 'viewer') {
  return api(emptySchema, `/knowledge-bases/${id}/members/${userId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function removeMember(token: string, id: string, userId: string) {
  return api(emptySchema, `/knowledge-bases/${id}/members/${userId}`, token, {
    method: 'DELETE',
  });
}

export function transferOwnership(token: string, id: string, toUserId: string) {
  return api(transferSchema, `/knowledge-bases/${id}/ownership-transfers`, token, {
    method: 'POST',
    body: JSON.stringify({ toUserId }),
  });
}

export function pendingOwnershipTransfer(token: string, id: string) {
  return api(transferSchema.nullable(), `/knowledge-bases/${id}/ownership-transfers`, token);
}

export function cancelOwnershipTransfer(token: string, id: string, transferId: string) {
  return api(emptySchema, `/knowledge-bases/${id}/ownership-transfers/${transferId}`, token, {
    method: 'DELETE',
  });
}

export function acceptOwnershipTransfer(token: string, transferId: string) {
  return api(knowledgeBaseSchema, `/ownership-transfers/${transferId}/accept`, token, {
    method: 'POST',
  });
}

export function invitationPreview(token: string) {
  return publicApi(invitationPreviewSchema, `/invitations/${token}`);
}

export function acceptInvitation(token: string, authToken: string) {
  return api(knowledgeBaseSchema, `/invitations/${token}/accept`, authToken, {
    method: 'POST',
  });
}

export function joinLinkPreview(token: string) {
  return publicApi(joinLinkPreviewSchema, `/join-links/${token}`);
}

export function acceptJoinLink(token: string, authToken: string) {
  return api(knowledgeBaseSchema, `/join-links/${token}/accept`, authToken, {
    method: 'POST',
  });
}

async function publicApi<T>(schema: z.ZodType<T>, path: string): Promise<ApiResult<T>> {
  const config = loadWebConfig();
  try {
    const response = await fetch(new URL(path, config.API_BASE_URL), {
      cache: 'no-store',
      signal: AbortSignal.timeout(config.API_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, detail: 'This link is not available.' };
    }
    return { ok: true, status: response.status, data: schema.parse(await response.json()) };
  } catch {
    return { ok: false, status: 0, detail: 'The API is unavailable.' };
  }
}

export type { JoinLink, Member };
