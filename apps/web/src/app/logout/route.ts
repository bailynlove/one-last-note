import { SESSION_COOKIE_NAME } from '@oln/domain';
import { type NextRequest, NextResponse } from 'next/server';
import { revokeSession } from '../../lib/auth';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await revokeSession(token);
  }

  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
