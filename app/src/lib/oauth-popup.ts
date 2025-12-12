/**
 * OAuth Popup Utility
 * Opens OAuth flow in a centered popup window
 */

/**
 * Open OAuth popup window
 *
 * Opens the OAuth authorization URL in a centered popup window.
 * User will authenticate and close the popup manually, then tell the agent when done.
 *
 * @param redirectUrl - OAuth authorization URL to open
 * @param state - OAuth state parameter for correlation (unused, kept for compatibility)
 * @param appId - App ID (unused, kept for compatibility)
 *
 * @example
 * openOAuthPopup(
 *   'https://api.dev-godaddy.com/v2/oauth2/authorize?...',
 *   'abc123',
 *   'app-456'
 * );
 */
export function openOAuthPopup(
  redirectUrl: string,
): void {
  // Calculate centered popup position
  const width = 480;
  const height = 640;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);

  // Open popup window with security features
  const popup = window.open(
    redirectUrl,
    "oauthPopup",
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no,noopener,noreferrer`
  );

  // Additional security: null out opener reference
  try {
    if (popup) {
      popup.opener = null;
    }
  } catch (e) {
    // Ignore - some browsers don't allow this
  }
}

// Export alias for backward compatibility
export const openOAuthPopupAndAwait = openOAuthPopup;
