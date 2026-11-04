import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const session = {
  token: 'session-token',
  expiresAt: '2026-12-04T00:00:00.000Z',
  user: {
    id: 'user-1',
    email: 'person@example.com',
    displayName: 'Person',
    avatarUrl: null,
    createdAt: '2026-11-04T00:00:00.000Z',
  },
};

function callbackRequest(query: string, state?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/auth/google/callback?${query}`, {
    headers: state ? { cookie: `oln_oauth_state=${state}` } : {},
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('rejects a missing or mismatched state without calling the API', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const missing = await GET(callbackRequest('code=code'));
  expect(missing.status).toBe(307);
  expect(missing.headers.get('location')).toBe('http://localhost:3000/login?error=google');

  const mismatched = await GET(callbackRequest('state=other&code=code', 'expected'));
  expect(mismatched.status).toBe(307);
  expect(mismatched.headers.get('location')).toBe('http://localhost:3000/login?error=google');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('exchanges the code and sets the session cookie', async () => {
  const fetchMock = vi.fn(async () => Response.json(session));
  vi.stubGlobal('fetch', fetchMock);

  const response = await GET(callbackRequest('state=expected&code=code', 'expected'));

  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('http://localhost:3000/');
  expect(response.headers.get('set-cookie')).toContain('oln_session=session-token');
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.toString()).toBe('http://localhost:4000/auth/google/exchange');
  expect(JSON.parse(String(init.body))).toEqual({ code: 'code' });
});
