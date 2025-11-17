/**
 * OAuth Popup Utility
 * Opens OAuth flow in a popup window and awaits completion via WebSocket
 */

import { getSharedSocket } from './socketRegistry';

/**
 * OAuth result from WebSocket event
 */
interface OAuthResult {
  success: boolean;
  appId: string;
  state: string;
  provider: 'godaddy';
  expiresAt?: number;
  scopes?: string[];
  error?: string;
  description?: string;
}

/**
 * Open OAuth popup and wait for authentication result
 *
 * Opens the OAuth authorization URL in a centered popup window and listens
 * for oauth:result WebSocket event. Returns a promise that resolves
 * when the OAuth flow completes (success or failure) or times out.
 *
 * @param redirectUrl - OAuth authorization URL to open
 * @param state - OAuth state parameter for correlation
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @returns Promise resolving to true on success, false on failure/timeout
 *
 * @example
 * const success = await openOAuthPopupAndAwait(
 *   'https://api.dev-godaddy.com/v2/oauth2/authorize?...',
 *   'abc123',
 *   300000
 * );
 * if (success) {
 *   // User authenticated successfully
 * }
 */
export function openOAuthPopupAndAwait(
  redirectUrl: string,
  state: string,
  appId: string,
  timeoutMs: number = 5 * 60 * 1000
): Promise<boolean> {
  return new Promise(async (resolve) => {
    // Use the shared WebSocket connection (from useStreamingWebSocket)
    // This ensures we don't miss events and avoids creating duplicate connections
    const socket = getSharedSocket();
    
    if (!socket) {
      console.error('[OAuth] No shared socket available. Ensure useStreamingWebSocket is initialized.');
      resolve(false);
      return;
    }

    // Wait for socket to be connected before opening popup
    await new Promise<void>((connectResolve) => {
      if (socket.connected) {
        connectResolve();
      } else {
        socket.once('connect', () => {
          connectResolve();
        });
        // Fallback: continue anyway after 2 seconds
        setTimeout(() => {
          connectResolve();
        }, 2000);
      }
    });

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

    if (!popup) {
      resolve(false);
      return;
    }

    let done = false;

    // Setup timeout (5 minutes - plenty of time for user to authenticate)
    const timer = setTimeout(() => {
      if (!done) {
        cleanup(false);
      }
    }, timeoutMs);

    /**
     * Cleanup function to remove listeners and close popup
     */
    function cleanup(success: boolean) {
      if (done) return; // Prevent double cleanup
      done = true;
      
      clearTimeout(timer);
      
      // Remove OAuth listener (but don't disconnect - socket is shared)
      socket.off('oauth:result', onOAuthResult);
      
      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch (e) {
        // Ignore errors closing popup (cross-origin or already closed)
      }
      
      resolve(success);
    }

    /**
     * Handle oauth:result WebSocket event
     */
    function onOAuthResult(data: OAuthResult) {
      // Validate message provider, state, AND appId to prevent cross-app mix-ups
      if (data?.provider === 'godaddy' && data?.state === state && data?.appId === appId) {
        cleanup(data.success);
      }
    }

    // Listen for oauth:result event via WebSocket
    socket.on('oauth:result', onOAuthResult);
  });
}
