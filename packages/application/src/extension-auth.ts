import { createHash } from 'node:crypto';
import {
  EXTENSION_AUTH_CODE_TTL_MS,
  EXTENSION_REFRESH_TTL_MS,
  isExtensionRedirectUri,
  isPkceChallenge,
  type User,
} from '@oln/domain';
import {
  type AuthRequestContext,
  type AuthService,
  type AuthSession,
  createToken,
  hashToken,
} from './auth';
import { AppError } from './errors';

export interface ConsumedExtensionCode {
  userId: string;
  challenge: string;
  redirectUri: string;
  user: User;
}

export interface ExtensionAuthStore {
  createCode(input: {
    userId: string;
    codeHash: string;
    challenge: string;
    redirectUri: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  consumeCode(input: { codeHash: string; now: Date }): Promise<ConsumedExtensionCode | null>;
  createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  rotateRefreshToken(input: {
    oldTokenHash: string;
    newTokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<User | null>;
  revokeRefreshToken(input: { tokenHash: string; now: Date }): Promise<void>;
}

export interface ExtensionAuthServiceOptions {
  store: ExtensionAuthStore;
  auth: AuthService;
  allowedExtensionId?: string;
  now?: () => Date;
}

export interface ExtensionSession {
  session: AuthSession;
  refreshToken: string;
  refreshExpiresAt: string;
}

export class ExtensionAuthService {
  private readonly now: () => Date;

  constructor(private readonly options: ExtensionAuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async authorize(input: {
    userId: string;
    challenge: string;
    redirectUri: string;
  }): Promise<{ code: string; expiresAt: string }> {
    if (!isPkceChallenge(input.challenge)) {
      throw new AppError('The extension authorization request is invalid.', {
        status: 400,
        title: 'Invalid authorization',
      });
    }
    if (!isExtensionRedirectUri(input.redirectUri, this.options.allowedExtensionId)) {
      throw new AppError('The extension redirect address is invalid.', {
        status: 400,
        title: 'Invalid authorization',
      });
    }

    const code = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + EXTENSION_AUTH_CODE_TTL_MS);
    await this.options.store.createCode({
      userId: input.userId,
      codeHash: hashToken(code),
      challenge: input.challenge,
      redirectUri: input.redirectUri,
      expiresAt,
      now,
    });

    return { code, expiresAt: expiresAt.toISOString() };
  }

  async exchange(input: {
    code: string;
    verifier: string;
    redirectUri: string;
    context: AuthRequestContext;
  }): Promise<ExtensionSession> {
    if (!isPkceVerifier(input.verifier)) {
      throw invalidCode();
    }

    const now = this.now();
    const consumed = await this.options.store.consumeCode({
      codeHash: hashToken(input.code),
      now,
    });
    if (!consumed || consumed.redirectUri !== input.redirectUri) {
      throw invalidCode();
    }

    if (createHash('sha256').update(input.verifier).digest('base64url') !== consumed.challenge) {
      throw invalidCode();
    }

    const session = await this.options.auth.createExtensionSession(consumed.user, input.context);
    const refreshToken = await this.issueRefreshToken(consumed.userId, now);

    return {
      session,
      refreshToken: refreshToken.token,
      refreshExpiresAt: refreshToken.expiresAt.toISOString(),
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.options.store.revokeRefreshToken({
      tokenHash: hashToken(refreshToken),
      now: this.now(),
    });
  }

  async refresh(input: {
    refreshToken: string;
    context: AuthRequestContext;
  }): Promise<ExtensionSession> {
    const now = this.now();
    const nextRefresh = createToken();
    const refreshExpiresAt = new Date(now.getTime() + EXTENSION_REFRESH_TTL_MS);
    const user = await this.options.store.rotateRefreshToken({
      oldTokenHash: hashToken(input.refreshToken),
      newTokenHash: hashToken(nextRefresh),
      expiresAt: refreshExpiresAt,
      now,
    });
    if (!user) {
      throw new AppError('The extension session has expired. Connect again.', {
        status: 401,
        title: 'Unauthorized',
      });
    }

    const session = await this.options.auth.createExtensionSession(user, input.context);

    return {
      session,
      refreshToken: nextRefresh,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  private async issueRefreshToken(
    userId: string,
    now: Date,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = createToken();
    const expiresAt = new Date(now.getTime() + EXTENSION_REFRESH_TTL_MS);
    await this.options.store.createRefreshToken({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      now,
    });
    return { token, expiresAt };
  }
}

function isPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function invalidCode(): AppError {
  return new AppError('This extension authorization is invalid or has expired.', {
    status: 400,
    title: 'Invalid authorization',
  });
}
