/**
 * Auth Cookie Utilities
 *
 * Shared utilities for reading authentication cookies
 */

/**
 * Get auth_idp token from cookie
 *
 * Extracts the JWT token from the auth_idp cookie. This is the primary
 * authentication token set by GoDaddy SSO.
 *
 * @returns JWT token string or null if not found
 */
export function getAuthTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'auth_idp') {
      return decodeURIComponent(value);
    }
  }
  return null;
}
