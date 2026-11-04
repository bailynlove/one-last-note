import { z } from 'zod';
import { authRequest } from './auth';

export const captureSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  userId: z.string(),
  url: z.string(),
  canonicalUrl: z.string().nullable(),
  selectionHtml: z.string().nullable(),
  selectionText: z.string().nullable(),
  status: z.enum(['queued', 'processing', 'ready', 'failed']),
  noteId: z.string().nullable(),
  revisionId: z.string().nullable(),
  duplicateOf: z.object({ noteId: z.string(), title: z.string() }).nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CaptureAttempt = z.infer<typeof captureSchema>;

export async function startCapture(
  token: string,
  knowledgeBaseId: string,
  url: string,
  idempotencyKey: string,
): Promise<{ ok: true; attempt: CaptureAttempt } | { ok: false; detail: string }> {
  const response = await authRequest(
    `/knowledge-bases/${knowledgeBaseId}/captures`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    },
    undefined,
    60_000,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    return { ok: false, detail: body?.detail ?? 'The page could not be captured.' };
  }
  const body = (await response.json()) as { attempt: unknown };
  const parsed = captureSchema.safeParse(body.attempt);
  return parsed.success
    ? { ok: true, attempt: parsed.data }
    : { ok: false, detail: 'The capture service returned an unexpected response.' };
}

export async function getCapture(token: string, attemptId: string): Promise<CaptureAttempt | null> {
  const response = await authRequest(
    `/captures/${attemptId}`,
    { headers: { authorization: `Bearer ${token}` } },
    undefined,
    60_000,
  );
  if (!response.ok) return null;
  const parsed = captureSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export async function retryCapture(token: string, attemptId: string): Promise<boolean> {
  const response = await authRequest(
    `/captures/${attemptId}/retry`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` } },
    undefined,
    60_000,
  );
  return response.ok;
}
