'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as lifecycle from '../../lib/lifecycle';
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
  if (!token) redirect(`/login?next=${encodeURIComponent(path)}`);
  return token;
}

export async function trashAssociationAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const noteId = text(form, 'noteId');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await lifecycle.trashAssociation(token, id, noteId);
  if (!result.ok) failure(path, result.detail);
  revalidatePath(path);
  redirect(`${path}?saved=trashed`);
}

export async function restoreAssociationAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const noteId = text(form, 'noteId');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  const result = await lifecycle.restoreAssociation(token, id, noteId);
  if (!result.ok) failure(path, result.detail);
  revalidatePath(path);
  redirect(`${path}?saved=restored`);
}

export async function deleteKnowledgeBaseAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = `/knowledge-bases/${id}`;
  const token = await tokenOrLogin(path);
  if (text(form, 'confirmName') !== text(form, 'expectedName')) {
    failure(path, 'Type the Knowledge Base name to confirm deletion.');
  }
  const result = await lifecycle.deleteKnowledgeBase(token, id);
  if (!result.ok) failure(path, result.detail);
  redirect('/knowledge-bases/trash?saved=deleted');
}

export async function restoreKnowledgeBaseAction(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const path = '/knowledge-bases/trash';
  const token = await tokenOrLogin(path);
  const result = await lifecycle.restoreKnowledgeBase(token, id);
  if (!result.ok) failure(path, result.detail);
  redirect(`/knowledge-bases/${result.data.id}?saved=restored`);
}
