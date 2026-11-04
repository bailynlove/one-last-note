import type { RelationGraph } from '@oln/domain';

export type RelationResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; detail: string };

async function request<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<RelationResult<T>> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, detail: 'The API is unreachable.' };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string; title?: string };
      detail = body.detail ?? body.title ?? detail;
    } catch {
      // Keep the status fallback.
    }
    return { ok: false, status: response.status, detail };
  }
  return { ok: true, data: (await response.json()) as T };
}

export async function fetchRelationGraph(
  token: string,
  knowledgeBaseId: string,
  filter: { revision?: string; type?: string; origin?: string; query?: string } = {},
): Promise<RelationResult<RelationGraph>> {
  const params = new URLSearchParams();
  if (filter.revision) params.set('revision', filter.revision);
  if (filter.type) params.set('type', filter.type);
  if (filter.origin) params.set('origin', filter.origin);
  if (filter.query) params.set('q', filter.query);
  const suffix = params.size > 0 ? `?${params}` : '';
  return request<RelationGraph>(token, `/knowledge-bases/${knowledgeBaseId}/relations${suffix}`);
}

export async function createRelation(
  token: string,
  knowledgeBaseId: string,
  input: { sourceNoteId: string; targetNoteId: string; type: string },
): Promise<RelationResult<{ relation: unknown }>> {
  return request(token, `/knowledge-bases/${knowledgeBaseId}/relations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function removeRelation(
  token: string,
  knowledgeBaseId: string,
  relationId: string,
): Promise<RelationResult<void>> {
  return request(token, `/knowledge-bases/${knowledgeBaseId}/relations/${relationId}`, {
    method: 'DELETE',
  });
}
