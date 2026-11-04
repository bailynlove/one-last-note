'use server';

import type { AnnotationAnchor } from '@oln/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createAnnotation,
  deleteAnnotation,
  replyToAnnotation,
  updateAnnotation,
} from '../../lib/annotations';
import { readSessionToken } from '../../lib/session';

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function notePath(formData: FormData): string {
  const noteId = field(formData, 'noteId');
  const knowledgeBaseId = field(formData, 'knowledgeBaseId');
  const revisionId = field(formData, 'revisionId');
  return `/notes/${noteId}?kb=${knowledgeBaseId}&revision=${revisionId}#annotations`;
}

function failed(formData: FormData, detail: string): never {
  const target = notePath(formData);
  redirect(`${target}&annotationError=${encodeURIComponent(detail)}`);
}

async function tokenOrFail(formData: FormData): Promise<string> {
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(notePath(formData))}`);
  }
  return token;
}

export async function createAnnotationAction(formData: FormData): Promise<void> {
  const token = await tokenOrFail(formData);
  const knowledgeBaseId = field(formData, 'knowledgeBaseId');
  const noteId = field(formData, 'noteId');
  const revisionId = field(formData, 'revisionId');
  const kind = field(formData, 'kind') === 'mark' ? 'mark' : 'comment';
  let anchor: AnnotationAnchor;
  try {
    anchor = JSON.parse(field(formData, 'anchor')) as AnnotationAnchor;
  } catch {
    failed(formData, 'Select a passage first.');
  }
  const result = await createAnnotation(token, knowledgeBaseId, noteId, {
    revisionId,
    kind,
    body: field(formData, 'body'),
    markType: field(formData, 'markType') || undefined,
    anchor,
  });
  if (!result.ok) {
    failed(formData, result.detail);
  }
  revalidatePath(`/notes/${noteId}`);
  redirect(notePath(formData));
}

export async function replyAnnotationAction(formData: FormData): Promise<void> {
  const token = await tokenOrFail(formData);
  const result = await replyToAnnotation(
    token,
    field(formData, 'knowledgeBaseId'),
    field(formData, 'noteId'),
    field(formData, 'annotationId'),
    field(formData, 'body'),
  );
  if (!result.ok) {
    failed(formData, result.detail);
  }
  revalidatePath(`/notes/${field(formData, 'noteId')}`);
  redirect(notePath(formData));
}

export async function updateAnnotationAction(formData: FormData): Promise<void> {
  const token = await tokenOrFail(formData);
  const result = await updateAnnotation(
    token,
    field(formData, 'knowledgeBaseId'),
    field(formData, 'noteId'),
    field(formData, 'annotationId'),
    field(formData, 'body'),
  );
  if (!result.ok) {
    failed(formData, result.detail);
  }
  revalidatePath(`/notes/${field(formData, 'noteId')}`);
  redirect(notePath(formData));
}

export async function deleteAnnotationAction(formData: FormData): Promise<void> {
  const token = await tokenOrFail(formData);
  const result = await deleteAnnotation(
    token,
    field(formData, 'knowledgeBaseId'),
    field(formData, 'noteId'),
    field(formData, 'annotationId'),
  );
  if (!result.ok) {
    failed(formData, result.detail);
  }
  revalidatePath(`/notes/${field(formData, 'noteId')}`);
  redirect(notePath(formData));
}
