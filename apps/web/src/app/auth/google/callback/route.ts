import { timingSafeEqual } from 'node:crypto';
import { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME } from '@oln/domain';
import { type NextRequest, NextResponse } from 'next/server';
import { exchangeGoogleCode } from '../../../../lib/auth';
import { sessionCookieOptions } from '../../../../lib/session';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');

  const fail = () => {
    const response = NextResponse.redirect(new URL('/login?error=google', request.url));
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return response;
  };

  if (!expectedState || !state || !safeEqual(expectedState, state) || !code) {
    return fail();
  }

  const session = await exchangeGoogleCode(code, request.headers.get('x-forwarded-for'));
  if (!session) {
    return fail();
  }

  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
  response.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
