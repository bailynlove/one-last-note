'use server';

import { redirect } from 'next/navigation';
import { createRelation, removeRelation } from '../../lib/relations';
import { readSessionToken } from '../../lib/session';

function back(knowledgeBaseId: string, message: string, note?: string, returnTo = ''): never {
  const params = new URLSearchParams(returnTo);
  params.delete('error');
  params.set('error', message.replace(/[\r\n\t]+/g, ' ').slice(0, 300));
  if (note) params.set('note', note);
  redirect(`/knowledge-bases/${knowledgeBaseId}/relations?${params}`);
}

export async function createRelationAction(formData: FormData): Promise<void> {
  const token = await readSessionToken();
  if (!token) redirect('/login');
  const knowledgeBaseId = String(formData.get('knowledgeBaseId') ?? '');
  const sourceNoteId = String(formData.get('sourceNoteId') ?? '');
  const targetNoteId = String(formData.get('targetNoteId') ?? '');
  const type = String(formData.get('type') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '');
  if (!knowledgeBaseId || !sourceNoteId || !targetNoteId || !type) {
    back(knowledgeBaseId, 'Choose two Notes and a Relation type.', undefined, returnTo);
  }
  const result = await createRelation(token, knowledgeBaseId, {
    sourceNoteId,
    targetNoteId,
    type,
  });
  if (!result.ok) back(knowledgeBaseId, result.detail, sourceNoteId, returnTo);
  const params = new URLSearchParams(returnTo);
  params.set('note', sourceNoteId);
  redirect(`/knowledge-bases/${knowledgeBaseId}/relations?${params}`);
}

export async function deleteRelationAction(formData: FormData): Promise<void> {
  const token = await readSessionToken();
  if (!token) redirect('/login');
  const knowledgeBaseId = String(formData.get('knowledgeBaseId') ?? '');
  const relationId = String(formData.get('relationId') ?? '');
  const note = String(formData.get('note') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '');
  const result = await removeRelation(token, knowledgeBaseId, relationId);
  if (!result.ok) back(knowledgeBaseId, result.detail, note || undefined, returnTo);
  const params = new URLSearchParams(returnTo);
  if (note) params.set('note', note);
  redirect(`/knowledge-bases/${knowledgeBaseId}/relations${params.size ? `?${params}` : ''}`);
}
