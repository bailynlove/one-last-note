import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuthService } from './auth';
import { ExtensionAuthService, type ExtensionAuthStore } from './extension-auth';

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function fakeService() {
  const codes = new Map<string, { userId: string; challenge: string; redirectUri: string }>();
  const refresh = new Map<string, string>();
  const store: ExtensionAuthStore = {
    async createCode(input) {
      codes.set(input.codeHash, {
        userId: input.userId,
        challenge: input.challenge,
        redirectUri: input.redirectUri,
      });
    },
    async consumeCode(input) {
      const row = codes.get(input.codeHash);
      if (!row) return null;
      codes.delete(input.codeHash);
      return {
        ...row,
        user: {
          id: row.userId,
          email: 'person@example.com',
          displayName: 'Person',
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        },
      };
    },
    async createRefreshToken(input) {
      refresh.set(input.tokenHash, input.userId);
    },
    async revokeRefreshToken(input) {
      refresh.delete(input.tokenHash);
    },
    async rotateRefreshToken(input) {
      const userId = refresh.get(input.oldTokenHash);
      if (!userId) return null;
      refresh.delete(input.oldTokenHash);
      refresh.set(input.newTokenHash, userId);
      return {
        id: userId,
        email: 'person@example.com',
        displayName: 'Person',
        avatarUrl: null,
        createdAt: new Date().toISOString(),
      };
    },
  };

  const auth = {
    async createExtensionSession() {
      return {
        token: 'session-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: {
          id: 'user-1',
          email: 'person@example.com',
          displayName: 'Person',
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        },
      };
    },
  } as unknown as AuthService;

  return new ExtensionAuthService({
    store,
    auth,
    now: () => new Date('2026-11-01T00:00:00.000Z'),
  });
}

const REDIRECT = `https://${'a'.repeat(32)}.chromiumapp.org/`;

describe('ExtensionAuthService', () => {
  it('issues and exchanges a PKCE authorization code once', async () => {
    const service = fakeService();
    const verifier = 'a'.repeat(43);
    const authorization = await service.authorize({
      userId: 'user-1',
      challenge: challengeFor(verifier),
      redirectUri: REDIRECT,
    });

    const first = await service.exchange({
      code: authorization.code,
      verifier,
      redirectUri: REDIRECT,
      context: { ip: '203.0.113.1' },
    });
    expect(first.session.token).toBe('session-token');
    expect(first.refreshToken).toBeTruthy();

    await expect(
      service.exchange({
        code: authorization.code,
        verifier,
        redirectUri: REDIRECT,
        context: { ip: '203.0.113.1' },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a verifier that does not match the challenge', async () => {
    const service = fakeService();
    const authorization = await service.authorize({
      userId: 'user-1',
      challenge: challengeFor('a'.repeat(43)),
      redirectUri: REDIRECT,
    });

    await expect(
      service.exchange({
        code: authorization.code,
        verifier: 'b'.repeat(43),
        redirectUri: REDIRECT,
        context: { ip: '203.0.113.1' },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid redirects and challenges', async () => {
    const service = fakeService();
    await expect(
      service.authorize({
        userId: 'user-1',
        challenge: 'short',
        redirectUri: REDIRECT,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.authorize({
        userId: 'user-1',
        challenge: challengeFor('a'.repeat(43)),
        redirectUri: 'https://evil.example/callback',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rotates refresh tokens and rejects the consumed token', async () => {
    const service = fakeService();
    const verifier = 'a'.repeat(43);
    const authorization = await service.authorize({
      userId: 'user-1',
      challenge: challengeFor(verifier),
      redirectUri: REDIRECT,
    });
    const session = await service.exchange({
      code: authorization.code,
      verifier,
      redirectUri: REDIRECT,
      context: { ip: '203.0.113.1' },
    });

    await expect(
      service.exchange({
        code: (
          await service.authorize({
            userId: 'user-1',
            challenge: challengeFor(verifier),
            redirectUri: REDIRECT,
          })
        ).code,
        verifier,
        redirectUri: `https://${'d'.repeat(32)}.chromiumapp.org/`,
        context: { ip: '203.0.113.1' },
      }),
    ).rejects.toMatchObject({ status: 400 });

    const refreshed = await service.refresh({
      refreshToken: session.refreshToken,
      context: { ip: '203.0.113.1' },
    });
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    await expect(
      service.refresh({ refreshToken: session.refreshToken, context: { ip: '203.0.113.1' } }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
