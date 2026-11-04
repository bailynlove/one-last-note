export const AGENT_SCOPES = ['read', 'write'] as const;
export type AgentTokenScope = (typeof AGENT_SCOPES)[number];

export const AGENT_TOKEN_PREFIX = 'oln_agent_';
export const AGENT_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const AGENT_TOKEN_MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const AGENT_RATE_LIMIT = 60;
export const AGENT_WRITE_LIMIT = 30;
export const AGENT_RATE_WINDOW_SECONDS = 60;

export interface AgentTokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: AgentTokenScope[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export function isAgentTokenScope(value: string): value is AgentTokenScope {
  return (AGENT_SCOPES as readonly string[]).includes(value);
}
