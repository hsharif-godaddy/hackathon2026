/**
 * mgmt-airo Authentication Utilities
 *
 * Handles dual SSO support: main app uses sso-dev, mgmt-airo uses sso-test
 */

const MGMT_AIRO_TOKEN_KEY = 'mgmt-airo-jwt';

/**
 * Store mgmt-airo JWT token in localStorage
 */
export function setMgmtAiroToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(MGMT_AIRO_TOKEN_KEY, token);
  }
}

/**
 * Get mgmt-airo JWT token from localStorage
 */
export function getMgmtAiroToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(MGMT_AIRO_TOKEN_KEY);
  }
  return null;
}

/**
 * Clear mgmt-airo JWT token
 */
export function clearMgmtAiroToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(MGMT_AIRO_TOKEN_KEY);
  }
}

/**
 * Open SSO login popup for mgmt-airo (sso-test)
 *
 * @param redirectUrl - URL to redirect after login (should be a callback handler)
 * @returns Promise that resolves when popup is closed
 */
export function openMgmtAiroSSOLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ssoHost = process.env.NEXT_PUBLIC_MGMT_AIRO_SSO_HOST || 'sso.test-godaddy.com';
    const callbackUrl = `${window.location.origin}/api/auth/mgmt-airo-callback`;
    const loginUrl = `https://${ssoHost}/login?redirect_uri=${encodeURIComponent(callbackUrl)}`;

    // Open popup
    const popup = window.open(
      loginUrl,
      'mgmt-airo-login',
      'width=600,height=700,left=200,top=100'
    );

    if (!popup) {
      reject(new Error('Failed to open login popup'));
      return;
    }

    // Poll for popup closure or token
    const pollTimer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(pollTimer);

          // Check if token was stored
          const token = getMgmtAiroToken();
          if (token) {
            resolve();
          } else {
            reject(new Error('Login cancelled or failed'));
          }
        }
      } catch (error) {
        // Ignore cross-origin errors while popup is on SSO domain
      }
    }, 500);
  });
}

/**
 * Check if mgmt-airo token exists and is not expired
 */
export function hasMgmtAiroToken(): boolean {
  const token = getMgmtAiroToken();
  if (!token) return false;

  try {
    // Simple JWT expiration check (decode payload without verification)
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    return exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
