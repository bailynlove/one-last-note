import { loadWebConfig } from '@oln/config';
import { readSessionToken } from '../../../lib/session';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const token = await readSessionToken();
  if (!token) return new Response('Unauthorized', { status: 401 });
  const { path } = await params;
  if (
    path?.length !== 2 ||
    !/^[0-9a-f-]{36}$/i.test(path[0] ?? '') ||
    !/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(path[1] ?? '')
  ) {
    return new Response('Not found', { status: 404 });
  }
  const config = loadWebConfig();
  const response = await fetch(
    new URL(`/capture-media/${path.map(encodeURIComponent).join('/')}`, config.API_BASE_URL),
    { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  if (!response.ok) return new Response('Not found', { status: response.status });
  return new Response(await response.arrayBuffer(), {
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
