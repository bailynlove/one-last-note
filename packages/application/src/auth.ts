import { createHash, randomBytes } from 'node:crypto';
import { displayNameFromEmail, normalizeEmail, type User } from '@oln/domain';
import { AppError, RateLimitError } from './errors';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_THROTTLE_LIMIT = 5;
export const AUTH_THROTTLE_WINDOW_SECONDS = 15 * 60;

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: User;
}

export interface GoogleIdentity {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface SessionContext {
  sessionId: string;
  user: User;
}

export interface AuthStore {
  findOrCreateUserByEmail(
    input: { email: string; displayName: string; avatarUrl?: string | null },
    now: Date,
  ): Promise<User>;
  findOrCreateGoogleUser(identity: GoogleIdentity, now: Date): Promise<User>;
  createMagicLink(input: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  consumeMagicLink(input: { tokenHash: string; now: Date }): Promise<string | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<void>;
  findSession(input: { tokenHash: string; now: Date }): Promise<SessionContext | null>;
  revokeSession(input: { tokenHash: string; now: Date }): Promise<void>;
}

export interface EmailSender {
  sendMagicLink(input: { to: string; url: string }): Promise<void>;
}

export interface AuthThrottle {
  consume(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export interface GoogleProvider {
  exchangeCode(code: string): Promise<GoogleIdentity>;
}

export interface AuthLogger {
  warn(details: unknown, message: string): void;
  error(details: unknown, message: string): void;
}

export interface AuthServiceOptions {
  store: AuthStore;
  email: EmailSender;
  throttle: AuthThrottle;
  google?: GoogleProvider;
  webAppUrl: string;
  now?: () => Date;
  logger?: AuthLogger;
}

export interface AuthRequestContext {
  ip: string;
  userAgent?: string | null;
}

export class AuthThrottleError extends RateLimitError {
  constructor(retryAfterSeconds: number) {
    super('Too many sign-in attempts. Try again later.', retryAfterSeconds);
    this.name = 'AuthThrottleError';
  }
}

export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async requestMagicLink(input: { email: string; ip: string }): Promise<void> {
    await this.allowAttempt(`ip:${input.ip}`);

    const email = normalizeEmail(input.email);
    const token = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);

    await this.options.store.createMagicLink({
      email,
      tokenHash: hashToken(token),
      expiresAt,
      now,
    });

    const url = new URL('/auth/verify', this.options.webAppUrl);
    url.searchParams.set('token', token);

    try {
      await this.options.email.sendMagicLink({ to: email, url: url.toString() });
    } catch (error) {
      this.options.logger?.error({ err: error }, 'magic link email delivery failed');
      throw new AppError('The sign-in email could not be sent. Try again.', {
        status: 503,
        title: 'Sign-in unavailable',
      });
    }
  }

  async consumeMagicLink(input: {
    token: string;
    ip: string;
    userAgent?: string | null;
  }): Promise<AuthSession> {
    await this.allowAttempt(`ip:${input.ip}`);

    const now = this.now();
    const email = await this.options.store.consumeMagicLink({
      tokenHash: hashToken(input.token),
      now,
    });

    if (!email) {
      throw new AppError('This sign-in link is invalid or has expired.', {
        status: 400,
        title: 'Invalid sign-in link',
      });
    }

    const user = await this.options.store.findOrCreateUserByEmail(
      {
        email,
        displayName: displayNameFromEmail(email),
      },
      now,
    );

    return this.issueSession(user, { ip: input.ip, userAgent: input.userAgent });
  }

  async completeGoogle(input: {
    code: string;
    ip: string;
    userAgent?: string | null;
  }): Promise<AuthSession> {
    await this.allowAttempt(`ip:${input.ip}`);

    if (!this.options.google) {
      throw new AppError('Google sign-in is not configured.', {
        status: 503,
        title: 'Sign-in unavailable',
      });
    }

    let identity: GoogleIdentity;
    try {
      identity = await this.options.google.exchangeCode(input.code);
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'google code exchange failed');
      throw new AppError('Google sign-in could not be completed.', {
        status: 400,
        title: 'Sign-in failed',
      });
    }

    if (!identity.emailVerified) {
      throw new AppError('Google did not verify this email address.', {
        status: 400,
        title: 'Sign-in failed',
      });
    }

    const email = normalizeEmail(identity.email);
    const user = await this.options.store.findOrCreateGoogleUser(
      {
        ...identity,
        email,
        displayName: identity.displayName || displayNameFromEmail(email),
      },
      this.now(),
    );

    return this.issueSession(user, { ip: input.ip, userAgent: input.userAgent });
  }

  async resolveSession(token: string | null): Promise<SessionContext | null> {
    if (!token) {
      return null;
    }

    return this.options.store.findSession({
      tokenHash: hashToken(token),
      now: this.now(),
    });
  }

  async createExtensionSession(user: User, context: AuthRequestContext): Promise<AuthSession> {
    return this.issueSession(user, context);
  }

  async signOut(token: string | null): Promise<void> {
    if (!token) {
      return;
    }

    await this.options.store.revokeSession({
      tokenHash: hashToken(token),
      now: this.now(),
    });
  }

  private async issueSession(user: User, context: AuthRequestContext): Promise<AuthSession> {
    const token = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    await this.options.store.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
      createdAt: now,
      userAgent: context.userAgent ?? null,
      ip: context.ip,
    });

    return { token, expiresAt: expiresAt.toISOString(), user };
  }

  private async allowAttempt(key: string): Promise<void> {
    const result = await this.options.throttle.consume(key);
    if (!result.allowed) {
      throw new AuthThrottleError(result.retryAfterSeconds);
    }
  }
}

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
