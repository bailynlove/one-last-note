import { timingSafeEqual } from 'node:crypto';
import type { AuthService } from '@oln/application';
import { AppError } from '@oln/application';
import { SESSION_COOKIE_NAME } from '@oln/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const emailBody = z.object({ email: z.email() });
const tokenBody = z.object({ token: z.string().min(1).max(500) });
const codeBody = z.object({ code: z.string().min(1).max(4_096) });

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientIp(request: FastifyRequest, proxySecret?: string): string {
  const forwardedSecret = request.headers['x-oln-proxy-secret'];
  const forwardedIp = request.headers['x-oln-client-ip'];
  if (
    proxySecret &&
    typeof forwardedSecret === 'string' &&
    typeof forwardedIp === 'string' &&
    forwardedIp.length <= 64 &&
    sameSecret(forwardedSecret, proxySecret)
  ) {
    return forwardedIp;
  }

  return request.ip;
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('The request body is invalid.', {
      status: 400,
      title: 'Invalid request',
    });
  }

  return result.data;
}

export function readSessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    return token || null;
  }

  const cookie = request.headers.cookie;
  if (!cookie) {
    return null;
  }

  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function requireUser(request: FastifyRequest, auth: AuthService) {
  const token = readSessionToken(request);
  const session = await auth.resolveSession(token);

  if (!session || !token) {
    throw new AppError('Sign in to continue.', {
      status: 401,
      title: 'Unauthorized',
    });
  }

  return { token, user: session.user };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  proxySecret?: string,
): void {
  app.post('/auth/magic-link', async (request, reply) => {
    const { email } = parseBody(emailBody, request.body);
    await auth.requestMagicLink({ email, ip: clientIp(request, proxySecret) });
    reply.status(202).send({ status: 'sent' });
  });

  app.post('/auth/magic-link/consume', async (request) => {
    const { token } = parseBody(tokenBody, request.body);
    return auth.consumeMagicLink({
      token,
      ip: clientIp(request, proxySecret),
      userAgent: request.headers['user-agent'] ?? null,
    });
  });

  app.post('/auth/google/exchange', async (request) => {
    const { code } = parseBody(codeBody, request.body);
    return auth.completeGoogle({
      code,
      ip: clientIp(request, proxySecret),
      userAgent: request.headers['user-agent'] ?? null,
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    await auth.signOut(readSessionToken(request));
    reply.status(204).send();
  });

  app.get('/auth/me', async (request) => {
    const { user } = await requireUser(request, auth);
    return { user };
  });

  app.post('/auth/extension-token', async (request) => {
    const { user } = await requireUser(request, auth);
    return auth.createExtensionSession(user, {
      ip: clientIp(request, proxySecret),
      userAgent: request.headers['user-agent'] ?? null,
    });
  });
}
