export const EXTENSION_AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const EXTENSION_REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Chrome extension IDs use letters a-p; chrome.identity redirects to this origin.
const EXTENSION_REDIRECT_PATTERN = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isExtensionRedirectUri(value: unknown, extensionId?: string): value is string {
  if (typeof value !== 'string' || !EXTENSION_REDIRECT_PATTERN.test(value)) return false;
  return extensionId ? value === `https://${extensionId}.chromiumapp.org/` : true;
}

export function isExtensionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-p]{32}$/.test(value);
}

export function isPkceChallenge(value: unknown): value is string {
  return typeof value === 'string' && PKCE_CHALLENGE_PATTERN.test(value);
}
