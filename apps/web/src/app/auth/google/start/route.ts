import { randomBytes } from 'node:crypto';
import { loadWebConfig } from '@oln/config';
import { GOOGLE_CALLBACK_PATH, OAUTH_STATE_COOKIE_NAME } from '@oln/domain';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = loadWebConfig();
  const clientId = config.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL('/login?error=google', request.url));
  }

  const state = randomBytes(32).toString('base64url');
  const redirectUri = new URL(GOOGLE_CALLBACK_PATH, config.WEB_APP_URL).toString();
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('prompt', 'select_account');

  const response = NextResponse.redirect(authorizationUrl);
  response.headers.set('cache-control', 'no-store');
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return response;
}
