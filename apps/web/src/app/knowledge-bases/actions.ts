'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as kb from '../../lib/knowledge-bases';
import { readSessionToken } from '../../lib/session';

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function failure(path: string, detail: string): never {
  redirect(`${path}?error=${encodeURIComponent(detail)}`);
}

async function tokenOrLogin(path: string): Promise<string> {
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return token;
}

export async function createKnowledgeBaseAction(form: FormData): Promise<void> {
  const token = await tokenOrLogin('/knowledge-bases/new');
  const result = await kb.createKnowledgeBase(token, {
    name: text(form, 'name'),
    description: text(form, 'description') || null,
  });
  if (!result.ok) {
    failure('/knowledge-bases/new', result.detail);
  }
  redirect(`/knowledge-bases/${result.data.id}`);
}

export async function updateKnowledgeBaseAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.updateKnowledgeBase(token, id, {
    name: text(form, 'name'),
    description: text(form, 'description') || null,
  });
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=settings`);
}

export async function inviteAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const role = text(form, 'role') === 'manager' ? 'manager' : 'viewer';
  const result = await kb.invite(token, id, { email: text(form, 'email'), role });
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=invitation`);
}

export async function resendInvitationAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.resendInvitation(token, id, text(form, 'invitationId'));
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=invitation`);
}

export async function revokeInvitationAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.revokeInvitation(token, id, text(form, 'invitationId'));
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=invitation`);
}

export async function changeRoleAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const role = text(form, 'role') === 'manager' ? 'manager' : 'viewer';
  const result = await kb.changeRole(token, id, text(form, 'userId'), role);
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=member`);
}

export async function removeMemberAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.removeMember(token, id, text(form, 'userId'));
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=member`);
}

export async function createJoinLinkAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const role = text(form, 'role') === 'manager' ? 'manager' : 'viewer';
  const days = Number(text(form, 'expiresInDays')) || 7;
  const result = await kb.createJoinLink(token, id, { role, expiresInDays: days });
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  (await cookies()).set('oln_join_preview', result.data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path,
    maxAge: 60,
  });
  redirect(`${path}?saved=join-link`);
}

export async function revokeJoinLinkAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.revokeJoinLink(token, id, text(form, 'joinLinkId'));
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=join-link`);
}

export async function transferOwnershipAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.transferOwnership(token, id, text(form, 'toUserId'));
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?transferId=${encodeURIComponent(result.data.id)}`);
}

export async function acceptInvitationAction(form: FormData): Promise<void> {
  const token = text(form, 'token');
  const authToken = await tokenOrLogin(`/invitations/${token}`);
  const result = await kb.acceptInvitation(token, authToken);
  if (!result.ok) {
    failure(`/invitations/${token}`, result.detail);
  }
  redirect(`/knowledge-bases/${result.data.id}`);
}

export async function cancelOwnershipTransferAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await kb.cancelOwnershipTransfer(token, id, text(form, 'transferId'));
  if (!result.ok) {
    failure(path, result.detail);
  }
  revalidatePath(path);
  redirect(`${path}?saved=transfer-cancelled`);
}

export async function acceptOwnershipTransferAction(form: FormData): Promise<void> {
  const transferId = text(form, 'transferId');
  const path = `/ownership-transfers/${transferId}`;
  const authToken = await tokenOrLogin(path);
  const result = await kb.acceptOwnershipTransfer(authToken, transferId);
  if (!result.ok) {
    failure(path, result.detail);
  }
  redirect(`/knowledge-bases/${result.data.id}`);
}

export async function acceptJoinLinkAction(form: FormData): Promise<void> {
  const token = text(form, 'token');
  const authToken = await tokenOrLogin(`/join/${token}`);
  const result = await kb.acceptJoinLink(token, authToken);
  if (!result.ok) {
    failure(`/join/${token}`, result.detail);
  }
  redirect(`/knowledge-bases/${result.data.id}`);
}
