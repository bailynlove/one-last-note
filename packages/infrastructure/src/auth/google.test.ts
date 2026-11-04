import { afterEach, expect, it, vi } from 'vitest';
import { createGoogleProvider } from './google';

const options = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:3000/auth/google/callback',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it('exchanges a code and maps a verified Google profile', async () => {
  const responses = [
    Response.json({ access_token: 'access-token' }),
    Response.json({
      sub: 'google-subject',
      email: 'Person@Example.com',
      email_verified: true,
      name: 'Person',
      picture: 'https://example.com/avatar.png',
    }),
  ];
  const fetchMock = vi.fn(async () => responses.shift() as Response);
  vi.stubGlobal('fetch', fetchMock);

  const identity = await createGoogleProvider(options).exchangeCode('code');

  expect(identity).toEqual({
    providerAccountId: 'google-subject',
    email: 'Person@Example.com',
    emailVerified: true,
    displayName: 'Person',
    avatarUrl: 'https://example.com/avatar.png',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
  expect(String(tokenInit.body)).toContain('code=code');
  const [userInfoUrl, userInfoInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(userInfoUrl).toBe('https://openidconnect.googleapis.com/v1/userinfo');
  expect((userInfoInit.headers as Record<string, string>).authorization).toBe(
    'Bearer access-token',
  );
});

it('passes through an unverified Google email for the application to reject', async () => {
  const responses = [
    Response.json({ access_token: 'access-token' }),
    Response.json({ sub: 'google-subject', email: 'person@example.com', email_verified: false }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => responses.shift() as Response),
  );

  const identity = await createGoogleProvider(options).exchangeCode('code');

  expect(identity.emailVerified).toBe(false);
  expect(identity.displayName).toBe('');
  expect(identity.avatarUrl).toBeNull();
});
