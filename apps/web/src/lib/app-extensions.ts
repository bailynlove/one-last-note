import type { AppExtensionInstallation } from '@oln/domain';

export type ExtensionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; detail: string };

async function request<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<ExtensionResult<T>> {
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

export async function listAppExtensions(
  token: string,
  knowledgeBaseId: string,
): Promise<ExtensionResult<AppExtensionInstallation[]>> {
  const result = await request<{ installations: AppExtensionInstallation[] }>(
    token,
    `/knowledge-bases/${knowledgeBaseId}/extensions`,
  );
  return result.ok ? { ok: true, data: result.data.installations } : result;
}

export async function installAppExtension(
  token: string,
  knowledgeBaseId: string,
  input: { manifest: unknown; files: Record<string, string>; source?: string },
): Promise<ExtensionResult<{ installation: AppExtensionInstallation }>> {
  return request(token, `/knowledge-bases/${knowledgeBaseId}/extensions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function setAppExtensionEnabled(
  token: string,
  knowledgeBaseId: string,
  installationId: string,
  enabled: boolean,
): Promise<ExtensionResult<{ installation: AppExtensionInstallation }>> {
  return request(token, `/knowledge-bases/${knowledgeBaseId}/extensions/${installationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function removeAppExtension(
  token: string,
  knowledgeBaseId: string,
  installationId: string,
): Promise<ExtensionResult<void>> {
  return request(token, `/knowledge-bases/${knowledgeBaseId}/extensions/${installationId}`, {
    method: 'DELETE',
  });
}
