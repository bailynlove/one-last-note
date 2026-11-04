export const SESSION_COOKIE_NAME = 'oln_session';
export const OAUTH_STATE_COOKIE_NAME = 'oln_oauth_state';
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function displayNameFromEmail(email: string): string {
  return normalizeEmail(email).split('@')[0] || 'User';
}
