import { loadWebConfig } from '@oln/config';
import { SESSION_COOKIE_NAME } from '@oln/domain';
import { type NextRequest, NextResponse } from 'next/server';
import { consumeMagicLink } from '../../../../lib/auth';
import { sessionCookieOptions } from '../../../../lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const baseUrl = loadWebConfig().WEB_APP_URL;
  const form = await request.formData();
  const token = String(form.get('token') ?? '');
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid', baseUrl), 303);
  }

  const session = await consumeMagicLink(token, request.headers.get('x-forwarded-for'));
  if (!session) {
    return NextResponse.redirect(new URL('/login?error=invalid', baseUrl), 303);
  }

  const response = NextResponse.redirect(new URL('/', baseUrl), 303);
  response.cookies.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
