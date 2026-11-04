import type { AuthService, ExtensionAuthService } from '@oln/application';
import { AppError } from '@oln/application';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientIp, requireUser } from './auth';

const authorizeBody = z.object({
  challenge: z.string().min(43).max(128),
  redirectUri: z.string().min(1).max(500),
});
const exchangeBody = z.object({
  code: z.string().min(1).max(500),
  verifier: z.string().min(43).max(128),
  redirectUri: z.string().min(1).max(500),
});
const refreshBody = z.object({ refreshToken: z.string().min(1).max(500) });

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('The request body is invalid.', {
      status: 400,
      title: 'Invalid request',
    });
  }
  return result.data;
}

export function registerExtensionAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  extensionAuth: ExtensionAuthService,
  proxySecret?: string,
): void {
  app.post('/auth/extension/authorize', async (request) => {
    const { user } = await requireUser(request, auth);
    const { challenge, redirectUri } = parse(authorizeBody, request.body);
    return extensionAuth.authorize({ userId: user.id, challenge, redirectUri });
  });

  app.post('/auth/extension/exchange', async (request) => {
    const { code, verifier, redirectUri } = parse(exchangeBody, request.body);
    const result = await extensionAuth.exchange({
      code,
      verifier,
      redirectUri,
      context: {
        ip: clientIp(request, proxySecret),
        userAgent: request.headers['user-agent'] ?? null,
      },
    });
    return {
      ...result.session,
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
    };
  });

  app.post('/auth/extension/revoke', async (request) => {
    const { refreshToken } = parse(refreshBody, request.body);
    await extensionAuth.revoke(refreshToken);
    return new Response(null, { status: 204 });
  });

  app.post('/auth/extension/refresh', async (request) => {
    const { refreshToken } = parse(refreshBody, request.body);
    const result = await extensionAuth.refresh({
      refreshToken,
      context: {
        ip: clientIp(request, proxySecret),
        userAgent: request.headers['user-agent'] ?? null,
      },
    });
    return {
      ...result.session,
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
    };
  });
}
