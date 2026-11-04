import { createHash, randomInt } from 'node:crypto';
import { AuthService, ExtensionAuthService } from '@oln/application';
import { createAuthStore, createAuthThrottle, createExtensionAuthStore } from '@oln/infrastructure';
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
const ipBase = `198.18.${randomInt(1, 255)}`;
const REDIRECT = `https://${'d'.repeat(32)}.chromiumapp.org/`;

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
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
    webAppUrl: 'http://localhost:3000',
  });
  app = startTestApi(testReadiness(stack), {
    auth,
    extensionAuth: new ExtensionAuthService({
      store: createExtensionAuthStore(stack.database),
      auth,
    }),
    trustProxy: 1,
  });
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

async function signIn(): Promise<string> {
  const email = `${uniqueName('saver')}@example.com`;
  const request = await app.inject({
    method: 'POST',
    url: '/auth/magic-link',
    payload: { email },
    headers: { 'x-forwarded-for': `${ipBase}.${randomInt(1, 200)}` },
  });
  expect(request.statusCode).toBe(202);
  const message = emails.at(-1);
  if (!message) throw new Error('no magic link');
  const token = new URL(message.url).searchParams.get('token');
  if (!token) throw new Error('no token');

  const consume = await app.inject({
    method: 'POST',
    url: '/auth/magic-link/consume',
    payload: { token },
    headers: { 'x-forwarded-for': `${ipBase}.250` },
  });
  expect(consume.statusCode).toBe(200);
  return (consume.json() as { token: string }).token;
}

describe('extension PKCE authorization', () => {
  it('authorizes, exchanges once, and refreshes a rotated token', async () => {
    const session = await signIn();
    const verifier = 'd'.repeat(43);
    const authorize = await app.inject({
      method: 'POST',
      url: '/auth/extension/authorize',
      headers: { authorization: `Bearer ${session}` },
      payload: {
        challenge: challengeFor(verifier),
        redirectUri: REDIRECT,
      },
    });
    expect(authorize.statusCode).toBe(200);
    const code = (authorize.json() as { code: string }).code;

    const exchange = await app.inject({
      method: 'POST',
      url: '/auth/extension/exchange',
      payload: { code, verifier, redirectUri: REDIRECT },
    });
    expect(exchange.statusCode).toBe(200);
    const tokens = exchange.json() as { token: string; refreshToken: string };
    expect(tokens.token).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const replay = await app.inject({
      method: 'POST',
      url: '/auth/extension/exchange',
      payload: { code, verifier, redirectUri: REDIRECT },
    });
    expect(replay.statusCode).toBe(400);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens.token}` },
    });
    expect(me.statusCode).toBe(200);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/extension/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json() as { refreshToken: string };
    expect(next.refreshToken).not.toBe(tokens.refreshToken);

    const revoke = await app.inject({
      method: 'POST',
      url: '/auth/extension/revoke',
      payload: { refreshToken: next.refreshToken },
    });
    expect(revoke.statusCode).toBe(204);
    const revokedRefresh = await app.inject({
      method: 'POST',
      url: '/auth/extension/refresh',
      payload: { refreshToken: next.refreshToken },
    });
    expect(revokedRefresh.statusCode).toBe(401);

    const replayRefresh = await app.inject({
      method: 'POST',
      url: '/auth/extension/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(replayRefresh.statusCode).toBe(401);
  });

  it('requires a signed-in web session to authorize', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/extension/authorize',
      payload: {
        challenge: challengeFor('e'.repeat(43)),
        redirectUri: `https://${'e'.repeat(32)}.chromiumapp.org/`,
      },
    });
    expect(response.statusCode).toBe(401);
  });
});
