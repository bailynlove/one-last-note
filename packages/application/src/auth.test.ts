import { normalizeEmail, type User } from '@oln/domain';
import { describe, expect, it } from 'vitest';
import {
  AuthService,
  type AuthStore,
  type AuthThrottle,
  AuthThrottleError,
  type EmailSender,
  type GoogleIdentity,
  type GoogleProvider,
  hashToken,
} from './auth';
import { AppError } from './errors';

function createHarness(options: { now?: () => Date; google?: GoogleProvider } = {}) {
  const now = options.now ?? (() => new Date('2026-11-04T12:00:00.000Z'));
  const users = new Map<string, User>();
  const identities = new Map<string, string>();
  const magicLinks = new Map<string, { email: string; expiresAt: Date; consumedAt: Date | null }>();
  const sessions = new Map<string, { user: User; expiresAt: Date; revokedAt: Date | null }>();
  const sent: { to: string; url: string }[] = [];
  const attempts = new Map<string, number>();
  let userId = 0;

  const store: AuthStore = {
    async findOrCreateUserByEmail(input, time) {
      const email = normalizeEmail(input.email);
      const existing = [...users.values()].find((user) => user.email === email);
      if (existing) {
        return existing;
      }

      const user: User = {
        id: `user-${++userId}`,
        email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl ?? null,
        createdAt: time.toISOString(),
      };
      users.set(user.id, user);
      return user;
    },
    async findOrCreateGoogleUser(identity, time) {
      const key = `google:${identity.providerAccountId}`;
      const linked = identities.get(key);
      if (linked) {
        const user = users.get(linked);
        if (user) {
          return user;
        }
      }

      const user = await this.findOrCreateUserByEmail(
        {
          email: identity.email,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
        },
        time,
      );
      identities.set(key, user.id);
      return user;
    },
    async createMagicLink(input) {
      magicLinks.set(input.tokenHash, {
        email: input.email,
        expiresAt: input.expiresAt,
        consumedAt: null,
      });
    },
    async consumeMagicLink(input) {
      const link = magicLinks.get(input.tokenHash);
      if (!link || link.consumedAt || link.expiresAt <= input.now) {
        return null;
      }

      link.consumedAt = input.now;
      return link.email;
    },
    async createSession(input) {
      const user = users.get(input.userId);
      if (!user) {
        throw new Error('missing user');
      }

      sessions.set(input.tokenHash, {
        user,
        expiresAt: input.expiresAt,
        revokedAt: null,
      });
    },
    async findSession(input) {
      const session = sessions.get(input.tokenHash);
      if (!session || session.revokedAt || session.expiresAt <= input.now) {
        return null;
      }

      return { sessionId: 'session', user: session.user };
    },
    async revokeSession(input) {
      const session = sessions.get(input.tokenHash);
      if (session) {
        session.revokedAt = input.now;
      }
    },
  };

  const email: EmailSender = {
    async sendMagicLink(message) {
      sent.push(message);
    },
  };

  const throttle: AuthThrottle = {
    async consume(key) {
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      return { allowed: count <= 5, retryAfterSeconds: count <= 5 ? 0 : 900 };
    },
  };

  const service = new AuthService({
    store,
    email,
    throttle,
    google: options.google,
    webAppUrl: 'http://localhost:3000',
    now,
  });

  return { service, sent, users, sessions, now };
}

function tokenFrom(message: { url: string }): string {
  const token = new URL(message.url).searchParams.get('token');
  if (!token) {
    throw new Error('magic link has no token');
  }

  return token;
}

function googleIdentity(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
  return {
    providerAccountId: 'google-123',
    email: 'Person@Example.com',
    emailVerified: true,
    displayName: 'Person',
    avatarUrl: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  it('sends a one-time magic link and creates a session when it is consumed', async () => {
    const harness = createHarness();
    await harness.service.requestMagicLink({ email: ' Person@Example.com ', ip: '1.1.1.1' });

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.to).toBe('person@example.com');

    const token = tokenFrom(harness.sent[0] as { url: string });
    const session = await harness.service.consumeMagicLink({ token, ip: '1.1.1.1' });

    expect(session.user.email).toBe('person@example.com');
    expect(session.token).toBeTruthy();
    expect(await harness.service.resolveSession(session.token)).toMatchObject({
      user: { email: 'person@example.com' },
    });
  });

  it('rejects a replayed or expired magic link without revealing which', async () => {
    let current = new Date('2026-11-04T12:00:00.000Z');
    const harness = createHarness({ now: () => current });
    await harness.service.requestMagicLink({ email: 'person@example.com', ip: '1.1.1.1' });
    const token = tokenFrom(harness.sent[0] as { url: string });

    await harness.service.consumeMagicLink({ token, ip: '1.1.1.1' });
    await expect(harness.service.consumeMagicLink({ token, ip: '1.1.1.1' })).rejects.toMatchObject({
      status: 400,
      message: 'This sign-in link is invalid or has expired.',
    });

    const expiring = createHarness({ now: () => current });
    await expiring.service.requestMagicLink({ email: 'other@example.com', ip: '2.2.2.2' });
    const expired = tokenFrom(expiring.sent[0] as { url: string });
    current = new Date('2026-11-04T12:16:00.000Z');
    await expect(
      expiring.service.consumeMagicLink({ token: expired, ip: '2.2.2.2' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('links a verified Google identity to the same user by email', async () => {
    const harness = createHarness({
      google: {
        async exchangeCode() {
          return googleIdentity();
        },
      },
    });

    await harness.service.requestMagicLink({ email: 'person@example.com', ip: '1.1.1.1' });
    const magicSession = await harness.service.consumeMagicLink({
      token: tokenFrom(harness.sent[0] as { url: string }),
      ip: '1.1.1.1',
    });

    const googleSession = await harness.service.completeGoogle({ code: 'code', ip: '2.2.2.2' });

    expect(googleSession.user.id).toBe(magicSession.user.id);
    expect(harness.users.size).toBe(1);
  });

  it('rejects a Google identity whose email is not verified', async () => {
    const harness = createHarness({
      google: {
        async exchangeCode() {
          return googleIdentity({ emailVerified: false });
        },
      },
    });

    await expect(
      harness.service.completeGoogle({ code: 'code', ip: '1.1.1.1' }),
    ).rejects.toMatchObject({ status: 400, title: 'Sign-in failed' });
  });

  it('revokes sessions immediately and forgets extension tokens after sign-out', async () => {
    const harness = createHarness();
    await harness.service.requestMagicLink({ email: 'person@example.com', ip: '1.1.1.1' });
    const session = await harness.service.consumeMagicLink({
      token: tokenFrom(harness.sent[0] as { url: string }),
      ip: '1.1.1.1',
    });
    const extension = await harness.service.createExtensionSession(session.user, {
      ip: '1.1.1.1',
    });

    await harness.service.signOut(extension.token);

    expect(await harness.service.resolveSession(extension.token)).toBeNull();
    expect(await harness.service.resolveSession(session.token)).not.toBeNull();
  });

  it('throttles the sixth attempt in the window', async () => {
    const harness = createHarness();

    for (let index = 0; index < 5; index += 1) {
      await harness.service.requestMagicLink({ email: `p${index}@example.com`, ip: '1.1.1.1' });
    }

    await expect(
      harness.service.requestMagicLink({ email: 'six@example.com', ip: '1.1.1.1' }),
    ).rejects.toBeInstanceOf(AuthThrottleError);
  });

  it('hashes tokens before storage', async () => {
    const harness = createHarness();
    await harness.service.requestMagicLink({ email: 'person@example.com', ip: '1.1.1.1' });
    const token = tokenFrom(harness.sent[0] as { url: string });

    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});
