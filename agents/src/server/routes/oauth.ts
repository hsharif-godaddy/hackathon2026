import { Router, type IRouter } from 'express';
import { AuthService, pkceStateStore } from '../../services/auth-service.js';
import { Logger } from '../../logging/index.js';
import { getSocketIO } from '../ai-lib-websocket-server.js';

const logger = Logger.create({ service: 'oauth-router' });
const router: IRouter = Router();

/**
 * OAuth callback endpoint for GoDaddy OAuth PKCE flow
 * 
 * Handles the redirect after user authentication with GoDaddy SSO.
 * Validates the authorization code and state, exchanges code for tokens,
 * and displays success or error page.
 * 
 * @route GET /oauth/godaddy/callback
 * @queryparam {string} code - Authorization code from GoDaddy OAuth
 * @queryparam {string} state - CSRF protection state parameter
 * @queryparam {string} [error] - Error code if OAuth failed
 * @queryparam {string} [error_description] - Human-readable error description
 * 
 * @example
 * // Success case:
 * // GET /oauth/godaddy/callback?code=abc123&state=uuid-state
 * // Returns HTML success page, auto-closes after 2 seconds
 * 
 * @example
 * // Error case:
 * // GET /oauth/godaddy/callback?error=access_denied&error_description=User+denied
 * // Returns HTML error page with details
 */
router.get('/oauth/godaddy/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    logger.info('oauth.callback.godaddy.received', {
        hasCode: !!code,
        hasState: !!state,
        hasError: !!error,
    });

    // Handle OAuth error responses
    if (error) {
        logger.error('oauth.callback.godaddy.oauth-error', {
            error,
            description: error_description,
        });

        // Try to emit error via WebSocket if we can map state -> appId
        const s = (state as string) || '';
        const pkce = s ? pkceStateStore.get(s) : undefined;
        if (pkce?.appId) {
            const io = getSocketIO();
            if (io) {
                io.emit('oauth:result', {
                    success: false,
                    appId: pkce.appId,
                    state: s,
                    provider: 'godaddy',
                    error: String(error),
                    description: error_description ? String(error_description) : ''
                });
                pkceStateStore.delete(s);
            }
        }

        return res.status(400).send(
            renderErrorPage(
                error as string,
                error_description as string | undefined
            )
        );
    }

    // Validate required parameters
    if (!code || !state) {
        logger.error('oauth.callback.godaddy.missing-params', {
            hasCode: !!code,
            hasState: !!state,
        });

        return res.status(400).send(
            renderErrorPage(
                'invalid_request',
                'Missing required parameters: code and state'
            )
        );
    }

    try {
        // Exchange authorization code for access token
        await AuthService.exchangeCode({
            code: code as string,
            state: state as string,
        });

        logger.info('oauth.callback.godaddy.success', {
            state: state as string
        });

        return res.status(200).send(renderSuccessPage(state as string));
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Try to emit error via WebSocket if we can map state -> appId
        const s = (state as string) || '';
        const pkce = s ? pkceStateStore.get(s) : undefined;
        if (pkce?.appId) {
            const io = getSocketIO();
            if (io) {
                io.emit('oauth:result', {
                    success: false,
                    appId: pkce.appId,
                    state: s,
                    provider: 'godaddy',
                    error: 'exchange_failed',
                    description: errorMessage,
                });
                pkceStateStore.delete(s);
            }
        }

        logger.error('oauth.callback.godaddy.exchange-failed', {
            error: errorMessage,
            state: state as string
        });

        return res.status(500).send(
            renderErrorPage('exchange_failed', errorMessage, state as string)
        );
    }
});

/**
 * Generate HTML success page for OAuth callback
 * 
 * Displays a success message with checkmark icon and auto-closes.
 * OAuth result is delivered via WebSocket instead of postMessage.
 * 
 * @param {string} state - OAuth state parameter for correlation
 * @returns {string} HTML page content
 */
function renderSuccessPage(state: string): string {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            text-align: center;
          }
          .success {
            background: #e8f5e9;
            padding: 30px;
            border-radius: 8px;
            border: 2px solid #4caf50;
          }
          .checkmark {
            font-size: 64px;
            color: #4caf50;
            margin-bottom: 20px;
          }
          h1 {
            color: #2e7d32;
            margin: 0 0 15px 0;
          }
          p {
            line-height: 1.6;
            color: #555;
            margin: 10px 0;
          }
          a {
            color: #2e7d32;
            text-decoration: underline;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <div class="checkmark">✓</div>
          <h1>Authentication Successful</h1>
          <p>You have been successfully authenticated with GoDaddy.</p>
          <p>This window will close automatically, or <a onclick="window.close()">click here to close</a>.</p>
        </div>
        <script>
          setTimeout(function() {
            window.close();
          }, 1200);
        </script>
      </body>
    </html>
  `;
}

/**
 * Generate HTML error page for OAuth callback
 * 
 * Displays error details with appropriate styling and auto-closes.
 * OAuth error result is delivered via WebSocket instead of postMessage.
 * 
 * @param {string} error - Error code
 * @param {string} [description] - Optional error description
 * @param {string} [state] - Optional OAuth state parameter
 * @returns {string} HTML page content
 */
function renderErrorPage(error: string, description?: string, state?: string): string {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Authentication Failed</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
          }
          h1 {
            color: #d32f2f;
          }
          p {
            line-height: 1.6;
            color: #555;
          }
          .error {
            background: #ffebee;
            padding: 20px;
            border-radius: 4px;
            border: 1px solid #ef5350;
            margin: 20px 0;
          }
          .error-code {
            font-family: monospace;
            background: #fff;
            padding: 10px;
            border-radius: 3px;
            margin-top: 10px;
            color: #c62828;
          }
          .retry {
            margin-top: 20px;
            padding: 15px;
            background: #e3f2fd;
            border-radius: 4px;
            border-left: 4px solid #2196f3;
          }
        </style>
      </head>
      <body>
        <h1>Authentication Failed</h1>
        <div class="error">
          <p><strong>Error:</strong> ${escapeHtml(error)}</p>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
        </div>
        <div class="retry">
          <p><strong>What to do next:</strong></p>
          <ul>
            <li>Close this window and try again</li>
            <li>Make sure you have the correct permissions</li>
            <li>Contact support if the problem persists</li>
          </ul>
        </div>
        <script>
          // Close automatically after user has time to read
          setTimeout(function() {
            window.close();
          }, 3000);
        </script>
      </body>
    </html>
  `;
}

/**
 * Escape HTML special characters to prevent XSS
 * 
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export default router;
