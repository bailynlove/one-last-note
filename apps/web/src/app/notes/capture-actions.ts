'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { retryCapture, startCapture } from '../../lib/captures';
import { readSessionToken } from '../../lib/session';

export async function capturePageAction(form: FormData): Promise<void> {
  const knowledgeBaseId = String(form.get('knowledgeBaseId') ?? '');
  const url = String(form.get('url') ?? '').trim();
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/knowledge-bases/${knowledgeBaseId}`)}`);
  }
  if (!url) {
    redirect(
      `/knowledge-bases/${knowledgeBaseId}?error=${encodeURIComponent('Enter a page URL.')}`,
    );
  }
  const result = await startCapture(token, knowledgeBaseId, url, randomUUID());
  if (!result.ok) {
    redirect(`/knowledge-bases/${knowledgeBaseId}?error=${encodeURIComponent(result.detail)}`);
  }
  revalidatePath(`/knowledge-bases/${knowledgeBaseId}`);
  redirect(`/captures/${result.attempt.id}`);
}

export async function retryCaptureAction(form: FormData): Promise<void> {
  const attemptId = String(form.get('attemptId') ?? '');
  const token = await readSessionToken();
  if (!token) redirect(`/login?next=${encodeURIComponent(`/captures/${attemptId}`)}`);
  await retryCapture(token, attemptId);
  revalidatePath(`/captures/${attemptId}`);
  redirect(`/captures/${attemptId}`);
}
