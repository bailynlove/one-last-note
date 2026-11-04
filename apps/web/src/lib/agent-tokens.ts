import { z } from 'zod';
import { authRequest } from './auth';

export interface AgentTokenSummary {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
const listSchema = z.object({ tokens: z.array(tokenSchema) });
const createdSchema = z.object({ token: z.string(), agentToken: tokenSchema });

export async function listAgentTokens(sessionToken: string): Promise<AgentTokenSummary[]> {
  const response = await authRequest('/agent-tokens', {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) throw new Error('Could not load Agent tokens.');
  const body = listSchema.safeParse(await response.json());
  if (!body.success) throw new Error('Malformed Agent token list.');
  return body.data.tokens;
}

export async function createAgentToken(
  sessionToken: string,
  input: { name: string; scopes: string[] },
): Promise<{ token: string; agentToken: AgentTokenSummary }> {
  const response = await authRequest('/agent-tokens', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? 'Could not create Agent token.');
  }
  const parsed = createdSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Malformed Agent token response.');
  return parsed.data;
}

export async function revokeAgentToken(sessionToken: string, id: string): Promise<void> {
  const response = await authRequest(`/agent-tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) throw new Error('Could not revoke Agent token.');
}
