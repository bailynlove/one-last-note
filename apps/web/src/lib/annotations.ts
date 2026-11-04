import type { Annotation, AnnotationAnchor } from '@oln/domain';
import { z } from 'zod';
import { authRequest } from './auth';

const authorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
const textAnchorSchema = z.object({
  kind: z.literal('text'),
  exact: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  path: z.string(),
});
const pdfAnchorSchema = z.object({
  kind: z.literal('pdf'),
  page: z.number(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});
const fields = {
  id: z.string(),
  knowledgeBaseId: z.string(),
  noteId: z.string(),
  revisionId: z.string(),
  originalRevisionId: z.string(),
  parentId: z.string().nullable(),
  author: authorSchema,
  kind: z.enum(['comment', 'mark']),
  markType: z.string().nullable(),
  body: z.string().nullable(),
  anchor: z.union([textAnchorSchema, pdfAnchorSchema]),
  needsReview: z.boolean(),
  deleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
};
export const annotationSchema = z.object({ ...fields, replies: z.array(z.any()).default([]) });

export type AnnotationApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string; status?: number };

async function api<T>(
  schema: z.ZodType<T>,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<AnnotationApiResult<T>> {
  try {
    const response = await authRequest(path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
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
        // Keep the generic message.
      }
      return { ok: false, detail, status: response.status };
    }
    return { ok: true, data: schema.parse(await response.json()) };
  } catch {
    return { ok: false, detail: 'The API is unavailable.' };
  }
}

function base(knowledgeBaseId: string, noteId: string) {
  return `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`;
}

export function listAnnotations(
  token: string,
  knowledgeBaseId: string,
  noteId: string,
  revisionId?: string,
) {
  const query = revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : '';
  return api(z.array(annotationSchema), `${base(knowledgeBaseId, noteId)}${query}`, token);
}

export function createAnnotation(
  token: string,
  knowledgeBaseId: string,
  noteId: string,
  input: {
    revisionId: string;
    kind: 'comment' | 'mark';
    body?: string;
    anchor: AnnotationAnchor & { source?: string };
  },
) {
  const { source: _source, ...anchor } = input.anchor;
  return api(annotationSchema, base(knowledgeBaseId, noteId), token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      revisionId: input.revisionId,
      kind: input.kind,
      body: input.body,
      anchor,
    }),
  });
}

export function replyToAnnotation(
  token: string,
  knowledgeBaseId: string,
  noteId: string,
  annotationId: string,
  body: string,
) {
  return api(annotationSchema, `${base(knowledgeBaseId, noteId)}/${annotationId}/replies`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

export function updateAnnotation(
  token: string,
  knowledgeBaseId: string,
  noteId: string,
  annotationId: string,
  body: string,
) {
  return api(annotationSchema, `${base(knowledgeBaseId, noteId)}/${annotationId}`, token, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

export async function deleteAnnotation(
  token: string,
  knowledgeBaseId: string,
  noteId: string,
  annotationId: string,
): Promise<AnnotationApiResult<null>> {
  try {
    const response = await authRequest(`${base(knowledgeBaseId, noteId)}/${annotationId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return { ok: false, detail: 'The Annotation could not be deleted.', status: response.status };
    }
    return { ok: true, data: null };
  } catch {
    return { ok: false, detail: 'The API is unavailable.' };
  }
}

export type { Annotation };
