import type { AuthSession } from '@oln/application';
import { loadWebConfig } from '@oln/config';
import type { User } from '@oln/domain';

export type MagicLinkResult = 'sent' | 'rate_limited' | 'failed';

function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const user = value as Partial<User>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.displayName === 'string' &&
    typeof user.createdAt === 'string' &&
    (user.avatarUrl === null || typeof user.avatarUrl === 'string')
  );
}

function readSession(value: unknown): AuthSession | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const session = value as Partial<AuthSession>;
  if (
    typeof session.token !== 'string' ||
    typeof session.expiresAt !== 'string' ||
    !isUser(session.user)
  ) {
    return null;
  }

  return { token: session.token, expiresAt: session.expiresAt, user: session.user };
}

function clientIpHeader(value: string | null | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined;
}

export async function authRequest(
  path: string,
  init: RequestInit = {},
  forwardedFor?: string | null,
  timeoutMs?: number,
): Promise<Response> {
  const config = loadWebConfig();
  const headers = new Headers(init.headers);
  const clientIp = clientIpHeader(forwardedFor);
  if (config.AUTH_PROXY_SECRET && clientIp) {
    headers.set('x-oln-client-ip', clientIp);
    headers.set('x-oln-proxy-secret', config.AUTH_PROXY_SECRET);
  }

  return fetch(new URL(path, config.API_BASE_URL), {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs ?? config.API_REQUEST_TIMEOUT_MS),
    ...init,
    headers,
  });
}

export async function requestMagicLink(
  email: string,
  forwardedFor?: string | null,
): Promise<MagicLinkResult> {
  try {
    const response = await authRequest(
      '/auth/magic-link',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      },
      forwardedFor,
    );

    if (response.status === 202) {
      return 'sent';
    }

    return response.status === 429 ? 'rate_limited' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function consumeMagicLink(
  token: string,
  forwardedFor?: string | null,
): Promise<AuthSession | null> {
  try {
    const response = await authRequest(
      '/auth/magic-link/consume',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      forwardedFor,
    );

    return response.ok ? readSession(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(
  code: string,
  forwardedFor?: string | null,
): Promise<AuthSession | null> {
  try {
    const response = await authRequest(
      '/auth/google/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      forwardedFor,
    );

    return response.ok ? readSession(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function fetchSessionUser(token: string): Promise<User | null> {
  try {
    const response = await authRequest('/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('user' in body)) {
      return null;
    }

    return isUser(body.user) ? body.user : null;
  } catch {
    return null;
  }
}

export async function revokeSession(token: string): Promise<void> {
  try {
    await authRequest('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    // Local sign-out should still clear the browser cookie if the API is unavailable.
  }
}
