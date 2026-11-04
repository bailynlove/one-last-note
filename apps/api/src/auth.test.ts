import type { AuthService } from '@oln/application';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerAuthRoutes } from './auth';

const secret = 'a-32-character-shared-secret-value';

it('uses a signed client IP from the web tier when the secret matches', async () => {
  const seen: string[] = [];
  const auth = {
    async requestMagicLink({ ip }: { ip: string }) {
      seen.push(ip);
    },
  } as unknown as AuthService;
  const app = Fastify();
  registerAuthRoutes(app, auth, secret);
  await app.ready();

  const accepted = await app.inject({
    method: 'POST',
    url: '/auth/magic-link',
    payload: { email: 'person@example.com' },
    headers: {
      'x-oln-proxy-secret': secret,
      'x-oln-client-ip': '198.51.100.7',
    },
  });
  expect(accepted.statusCode).toBe(202);
  expect(seen).toEqual(['198.51.100.7']);

  const rejected = await app.inject({
    method: 'POST',
    url: '/auth/magic-link',
    payload: { email: 'person@example.com' },
    headers: {
      'x-oln-proxy-secret': 'wrong-secret',
      'x-oln-client-ip': '198.51.100.8',
    },
  });
  expect(rejected.statusCode).toBe(202);
  expect(seen.at(-1)).not.toBe('198.51.100.8');

  await app.close();
});
