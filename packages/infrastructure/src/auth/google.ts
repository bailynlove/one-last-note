import type { GoogleIdentity, GoogleProvider } from '@oln/application';

export interface GoogleProviderOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token?: string;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export function createGoogleProvider(options: GoogleProviderOptions): GoogleProvider {
  return {
    async exchangeCode(code: string): Promise<GoogleIdentity> {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: options.clientId,
          client_secret: options.clientSecret,
          redirect_uri: options.redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Google token exchange failed (${tokenResponse.status})`);
      }

      const token = (await tokenResponse.json()) as TokenResponse;
      if (!token.access_token) {
        throw new Error('Google token exchange returned no access token');
      }

      const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(5_000),
      });

      if (!userInfoResponse.ok) {
        throw new Error(`Google userinfo failed (${userInfoResponse.status})`);
      }

      const profile = (await userInfoResponse.json()) as UserInfoResponse;
      if (!profile.sub || !profile.email) {
        throw new Error('Google userinfo returned no subject or email');
      }

      return {
        providerAccountId: profile.sub,
        email: profile.email,
        emailVerified: profile.email_verified === true,
        displayName: profile.name ?? '',
        avatarUrl: profile.picture ?? null,
      };
    },
  };
}
