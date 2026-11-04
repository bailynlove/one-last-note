import { randomInt, randomUUID } from 'node:crypto';
import { AuthService, hashToken } from '@oln/application';
import { createAuthStore, createAuthThrottle } from '@oln/infrastructure';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startTestApi,
  startTestStack,
  type TestStack,
  testReadiness,
  uniqueName,
} from './fixtures';

let stack: TestStack;
let app: FastifyInstance;
const emails: { to: string; url: string }[] = [];
const ipBase = `10.${randomInt(1, 255)}.${randomInt(1, 255)}`;

function testIp(suffix: number): string {
  return `${ipBase}.${suffix}`;
}

function googleIdentity(email: string, verified: boolean, accountId = `google-${email}`) {
  return {
    providerAccountId: accountId,
    email,
    emailVerified: verified,
    displayName: 'Google Person',
    avatarUrl: null,
  };
}

beforeAll(async () => {
  stack = await startTestStack();
  const auth = new AuthService({
    store: createAuthStore(stack.database),
    email: {
      async sendMagicLink(message) {
        emails.push(message);
      },
    },
    throttle: createAuthThrottle(stack.redis),
    google: {
      async exchangeCode(code) {
        if (code.startsWith('google:')) {
          const [, accountId, email] = code.split(':');
          return googleIdentity(email as string, true, accountId as string);
        }

        return googleIdentity(
          code === 'unverified' ? 'unverified@example.com' : 'google-person@example.com',
          code !== 'unverified',
        );
      },
    },
    webAppUrl: 'http://localhost:3000',
  });

  app = startTestApi(testReadiness(stack), { auth, trustProxy: 1 });
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

async function requestMagicLink(email: string, ip: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/magic-link',
    payload: { email },
    headers: { 'x-forwarded-for': ip },
  });
  expect(response.statusCode).toBe(202);

  const message = emails.at(-1);
  if (!message) {
    throw new Error('no magic link email was sent');
  }

  const token = new URL(message.url).searchParams.get('token');
  if (!token) {
    throw new Error('magic link email has no token');
  }

  return token;
}

async function consume(token: string, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/magic-link/consume',
    payload: { token },
    headers: { 'x-forwarded-for': ip },
  });
}

describe('authentication with real storage', () => {
  it('signs in with a magic link, authenticates API calls, and revokes sessions', async () => {
    const email = `${uniqueName('person')}@example.com`;
    const token = await requestMagicLink(email, testIp(1));

    const response = await consume(token, testIp(1));
    expect(response.statusCode).toBe(200);
    const session = response.json() as { token: string; user: { id: string } };
    expect(session.user.id).toBeTruthy();
    expect(session.token).toBeTruthy();

    const bearerMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(bearerMe.statusCode).toBe(200);
    expect(bearerMe.json()).toMatchObject({ user: { id: session.user.id, email } });

    const cookieMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `oln_session=${session.token}` },
    });
    expect(cookieMe.statusCode).toBe(200);

    const extension = await app.inject({
      method: 'POST',
      url: '/auth/extension-token',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(extension.statusCode).toBe(200);
    const extensionToken = (extension.json() as { token: string }).token;

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(logout.statusCode).toBe(204);

    const revoked = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.headers['www-authenticate']).toBe('Bearer');

    const extensionMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${extensionToken}` },
    });
    expect(extensionMe.statusCode).toBe(200);
  });

  it('rejects an expired magic link against the real store', async () => {
    const store = createAuthStore(stack.database);
    const token = `expired-${randomUUID()}`;
    await store.createMagicLink({
      email: `${uniqueName('expired')}@example.com`,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() - 1_000),
      now: new Date(),
    });

    const response = await consume(token, testIp(7));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a replayed magic link', async () => {
    const email = `${uniqueName('replay')}@example.com`;
    const token = await requestMagicLink(email, testIp(2));

    expect((await consume(token, testIp(2))).statusCode).toBe(200);
    const replay = await consume(token, testIp(2));

    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({
      title: 'Invalid sign-in link',
      detail: 'This sign-in link is invalid or has expired.',
    });
    expect(replay.body).not.toContain(email);
  });

  it('links Google sign-in to a user with the same verified email', async () => {
    const email = 'google-person@example.com';
    const token = await requestMagicLink(email, testIp(3));
    const magic = await consume(token, testIp(3));
    const magicUser = (magic.json() as { user: { id: string } }).user;

    const google = await app.inject({
      method: 'POST',
      url: '/auth/google/exchange',
      payload: { code: 'ok' },
      headers: { 'x-forwarded-for': testIp(3) },
    });
    expect(google.statusCode).toBe(200);
    expect(google.json()).toMatchObject({ user: { id: magicUser.id, email } });

    const unverified = await app.inject({
      method: 'POST',
      url: '/auth/google/exchange',
      payload: { code: 'unverified' },
      headers: { 'x-forwarded-for': testIp(4) },
    });
    expect(unverified.statusCode).toBe(400);
    expect(unverified.json()).toMatchObject({ title: 'Sign-in failed' });
  });

  it('keeps a User stable when Google changes the email for one provider account', async () => {
    const accountId = uniqueName('google-account');
    const firstEmail = `${uniqueName('google-first')}@example.com`;
    const changedEmail = `${uniqueName('google-changed')}@example.com`;

    const first = await app.inject({
      method: 'POST',
      url: '/auth/google/exchange',
      payload: { code: `google:${accountId}:${firstEmail}` },
      headers: { 'x-forwarded-for': testIp(10) },
    });
    const changed = await app.inject({
      method: 'POST',
      url: '/auth/google/exchange',
      payload: { code: `google:${accountId}:${changedEmail}` },
      headers: { 'x-forwarded-for': testIp(10) },
    });

    expect(first.statusCode).toBe(200);
    expect(changed.statusCode).toBe(200);
    expect((changed.json() as { user: { id: string } }).user.id).toBe(
      (first.json() as { user: { id: string } }).user.id,
    );
  });

  it('throttles authentication attempts per IP', async () => {
    const ip = testIp(5);
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: `throttle-${index}@example.com` },
        headers: { 'x-forwarded-for': ip },
      });
      expect(response.statusCode).toBe(202);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'throttle-blocked@example.com' },
      headers: { 'x-forwarded-for': ip },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('shares one throttle across authentication actions', async () => {
    const ip = testIp(8);
    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: `shared-throttle-${index}@example.com` },
        headers: { 'x-forwarded-for': ip },
      });
      expect(response.statusCode).toBe(202);
    }

    expect((await consume('invalid-one', ip)).statusCode).toBe(400);
    expect((await consume('invalid-two', ip)).statusCode).toBe(400);

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'shared-throttle-blocked@example.com' },
      headers: { 'x-forwarded-for': ip },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('rejects an expired session immediately', async () => {
    const email = `${uniqueName('expired-session')}@example.com`;
    const token = await requestMagicLink(email, testIp(9));
    const session = (await consume(token, testIp(9))).json() as { token: string };

    await stack.database.db.execute(
      sql`update sessions set expires_at = now() - interval '1 second' where token_hash = ${hashToken(session.token)}`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('treats a malformed session cookie as unauthenticated', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'oln_session=%' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns a consistent problem response without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('rejects malformed credentials without leaking account state', async () => {
    const invalidLink = await consume('not-a-real-token', testIp(6));
    expect(invalidLink.statusCode).toBe(400);
    expect(invalidLink.json()).toMatchObject({
      detail: 'This sign-in link is invalid or has expired.',
    });

    const invalidEmail = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'not-an-email' },
      headers: { 'x-forwarded-for': testIp(6) },
    });
    expect(invalidEmail.statusCode).toBe(400);
    expect(invalidEmail.json()).toMatchObject({ status: 400 });
  });
});
