'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attachNote, replaceNote, updateNoteTitle, uploadNote } from '../../lib/notes';
import { readSessionToken } from '../../lib/session';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function errorUrl(path: string, detail: string): string {
  return `${path}?error=${encodeURIComponent(detail)}`;
}

export async function uploadNoteAction(form: FormData): Promise<void> {
  const knowledgeBaseId = text(form, 'knowledgeBaseId');
  const file = form.get('file');
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/knowledge-bases/${knowledgeBaseId}`)}`);
  }
  if (!(file instanceof File) || file.size === 0) {
    redirect(errorUrl(`/knowledge-bases/${knowledgeBaseId}`, 'Choose a file to upload.'));
  }
  const result = await uploadNote(token, knowledgeBaseId, file, text(form, 'title'));
  if (!result.ok) {
    redirect(errorUrl(`/knowledge-bases/${knowledgeBaseId}`, result.detail));
  }
  revalidatePath(`/knowledge-bases/${knowledgeBaseId}`);
  redirect(`/knowledge-bases/${knowledgeBaseId}#notes`);
}

export async function replaceNoteAction(form: FormData): Promise<void> {
  const noteId = text(form, 'noteId');
  const file = form.get('file');
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/notes/${noteId}`)}`);
  }
  if (!(file instanceof File) || file.size === 0) {
    redirect(errorUrl(`/notes/${noteId}`, 'Choose a replacement file.'));
  }
  const result = await replaceNote(token, noteId, file, text(form, 'title'));
  if (!result.ok) {
    redirect(errorUrl(`/notes/${noteId}`, result.detail));
  }
  revalidatePath(`/notes/${noteId}`);
  redirect(`/notes/${noteId}`);
}

export async function attachNoteAction(form: FormData): Promise<void> {
  const noteId = text(form, 'noteId');
  const source = text(form, 'sourceKnowledgeBaseId');
  const target = text(form, 'targetKnowledgeBaseId');
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/notes/${noteId}`)}`);
  }
  const result = await attachNote(token, noteId, source, target);
  if (!result.ok) {
    redirect(errorUrl(`/notes/${noteId}`, result.detail));
  }
  revalidatePath(`/notes/${noteId}`);
  redirect(`/notes/${noteId}`);
}

export async function updateNoteTitleAction(form: FormData): Promise<void> {
  const noteId = text(form, 'noteId');
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/notes/${noteId}`)}`);
  }
  const result = await updateNoteTitle(token, noteId, text(form, 'title'));
  if (!result.ok) {
    redirect(errorUrl(`/notes/${noteId}`, result.detail));
  }
  revalidatePath(`/notes/${noteId}`);
  redirect(`/notes/${noteId}`);
}
