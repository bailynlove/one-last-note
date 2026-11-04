import { z } from 'zod';
import { authRequest } from './auth';

const revisionSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  revisionNumber: z.number(),
  originalFilename: z.string(),
  mediaType: z.string(),
  byteSize: z.number(),
  contentHash: z.string(),
  status: z.enum(['quarantined', 'ready', 'rejected']),
  statusDetail: z.string().nullable(),
  uploadedByUserId: z.string(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
const associationSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  knowledgeBaseName: z.string(),
  createdAt: z.string(),
});
export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  currentRevisionId: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  associations: z.array(associationSchema),
  revisions: z.array(revisionSchema),
});
const summarySchema = z.object({
  id: z.string(),
  title: z.string(),
  currentRevisionId: z.string().nullable(),
  latestRevision: revisionSchema.nullable(),
  associationCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Note = z.infer<typeof noteSchema>;
export type NoteSummary = z.infer<typeof summarySchema>;
export type NoteRevision = z.infer<typeof revisionSchema>;

export type NoteApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string; status?: number };

async function api<T>(
  schema: z.ZodType<T>,
  path: string,
  token: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<NoteApiResult<T>> {
  try {
    const response = await authRequest(
      path,
      {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
      },
      null,
      timeoutMs,
    );
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

export function listNotes(token: string, knowledgeBaseId: string) {
  return api(z.array(summarySchema), `/knowledge-bases/${knowledgeBaseId}/notes`, token);
}

export function getNote(token: string, noteId: string) {
  return api(noteSchema, `/notes/${noteId}`, token);
}

function uploadBody(file: File, title: string) {
  const body = new FormData();
  body.set('file', file, file.name);
  if (title.trim()) {
    body.set('title', title.trim());
  }
  return body;
}

export function uploadNote(token: string, knowledgeBaseId: string, file: File, title: string) {
  return api(
    noteSchema,
    `/knowledge-bases/${knowledgeBaseId}/notes`,
    token,
    { method: 'POST', body: uploadBody(file, title) },
    60_000,
  );
}

export function replaceNote(token: string, noteId: string, file: File, title: string) {
  return api(
    noteSchema,
    `/notes/${noteId}/revisions`,
    token,
    { method: 'POST', body: uploadBody(file, title) },
    60_000,
  );
}

export function attachNote(
  token: string,
  noteId: string,
  sourceKnowledgeBaseId: string,
  targetKnowledgeBaseId: string,
) {
  return api(noteSchema, `/notes/${noteId}/associations`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceKnowledgeBaseId, targetKnowledgeBaseId }),
  });
}

export function updateNoteTitle(token: string, noteId: string, title: string) {
  return api(noteSchema, `/notes/${noteId}`, token, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function downloadRevision(
  token: string,
  noteId: string,
  revisionId: string,
): Promise<Response> {
  return authRequest(`/notes/${noteId}/revisions/${revisionId}/original`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fetchRevisionBytes(
  token: string,
  noteId: string,
  revisionId: string,
): Promise<NoteApiResult<Uint8Array>> {
  try {
    const response = await downloadRevision(token, noteId, revisionId);
    if (!response.ok) {
      return { ok: false, detail: 'The original could not be loaded.' };
    }
    return { ok: true, data: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { ok: false, detail: 'The API is unavailable.' };
  }
}
