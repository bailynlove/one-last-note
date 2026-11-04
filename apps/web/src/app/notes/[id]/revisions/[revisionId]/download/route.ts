import { downloadRevision } from '../../../../../../lib/notes';
import { readSessionToken } from '../../../../../../lib/session';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
): Promise<Response> {
  const token = await readSessionToken();
  if (!token) {
    return new Response('Sign in to download this Revision.', { status: 401 });
  }
  const { id, revisionId } = await params;
  const response = await downloadRevision(token, id, revisionId);
  if (!response.ok) {
    return new Response('That Revision is not available.', { status: response.status });
  }
  return new Response(response.body, {
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': response.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'private, no-store',
    },
  });
}
