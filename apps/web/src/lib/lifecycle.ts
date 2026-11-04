import { z } from 'zod';
import { authRequest } from './auth';

const trashedSchema = z.object({
  noteId: z.string(),
  noteTitle: z.string(),
  knowledgeBaseId: z.string(),
  knowledgeBaseName: z.string(),
  trashedAt: z.string(),
  purgeAfter: z.string(),
});
const deletedSchema = z.object({
  id: z.string(),
  name: z.string(),
  deletedAt: z.string(),
  purgeAfter: z.string(),
  noteCount: z.number(),
});
const trashListSchema = z.object({ associations: z.array(trashedSchema) });
const deletedListSchema = z.object({ knowledgeBases: z.array(deletedSchema) });

export type TrashedAssociation = z.infer<typeof trashedSchema>;
export type DeletedKnowledgeBase = z.infer<typeof deletedSchema>;
export type LifecycleResult<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string; status?: number };

async function request<T>(
  schema: z.ZodType<T> | null,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<LifecycleResult<T>> {
  try {
    const response = await authRequest(path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok) {
      let detail = 'The request could not be completed.';
      try {
        const problem: unknown = await response.json();
        if (typeof problem === 'object' && problem !== null && 'detail' in problem) {
          const value = (problem as { detail?: unknown }).detail;
          if (typeof value === 'string') detail = value;
        }
      } catch {
        // Keep fallback.
      }
      return { ok: false, detail, status: response.status };
    }
    if (response.status === 204) return { ok: true, data: undefined as T };
    const body: unknown = await response.json();
    if (!schema) return { ok: true, data: body as T };
    const parsed = schema.safeParse(body);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, detail: 'The server returned an unexpected response.' };
  } catch {
    return { ok: false, detail: 'The server could not be reached.' };
  }
}

export function listTrash(token: string, knowledgeBaseId: string) {
  return request(trashListSchema, `/knowledge-bases/${knowledgeBaseId}/trash`, token);
}

export function trashAssociation(token: string, knowledgeBaseId: string, noteId: string) {
  return request(null, `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/association`, token, {
    method: 'DELETE',
  });
}

export function restoreAssociation(token: string, knowledgeBaseId: string, noteId: string) {
  return request(
    trashedSchema,
    `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/restore`,
    token,
    { method: 'POST' },
  );
}

export function deleteKnowledgeBase(token: string, knowledgeBaseId: string) {
  return request(null, `/knowledge-bases/${knowledgeBaseId}`, token, { method: 'DELETE' });
}

export function restoreKnowledgeBase(token: string, knowledgeBaseId: string) {
  return request(deletedSchema, `/knowledge-bases/${knowledgeBaseId}/restore`, token, {
    method: 'POST',
  });
}

export function listDeletedKnowledgeBases(token: string) {
  return request(deletedListSchema, '/knowledge-bases/deleted', token);
}
