import { Router, type IRouter } from 'express';
import { randomBytes } from 'crypto';
import { AuthService, pkceStateStore } from '../../services/auth-service.js';
import { Logger } from '../../logging/index.js';
import { getSocketIO } from '../ai-lib-websocket-server.js';

const logger = Logger.create({ component: 'oauth-router' });
const router: IRouter = Router();

const AUTO_CLOSE_COUNTDOWN_SECONDS = 10;
const FALLBACK_MESSAGE_DELAY_MS = 100; // Allow time for window.close() to complete before updating UI

function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

router.get('/godaddy/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  logger.info('oauth.callback.godaddy.received', {
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
  });

  const nonce = generateNonce();

  res.setHeader(
    'Content-Security-Policy',
    `script-src 'self' 'nonce-${nonce}'; script-src-attr 'none'`
  );

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
          description: error_description ? String(error_description) : '',
        });
      }
    }

    // Always delete PKCE state on OAuth error to prevent replay attacks
    if (s) {
      pkceStateStore.delete(s);
    }

    return res
      .status(400)
      .send(renderErrorPage(error as string, error_description as string | undefined, nonce));
  }

  if (!code || !state) {
    logger.error('oauth.callback.godaddy.missing-params', {
      hasCode: !!code,
      hasState: !!state,
    });

    return res
      .status(400)
      .send(renderErrorPage('invalid_request', 'Missing required parameters: code and state', nonce));
  }

  try {
    const result = await AuthService.exchangeCode({
      code: code as string,
      state: state as string,
    });

    logger.info('oauth.callback.godaddy.success', {
      state: state as string,
    });

    const s = state as string;
    const pkce = pkceStateStore.get(s);
    if (pkce?.appId) {
      const io = getSocketIO();
      if (io) {
        io.emit('oauth:result', {
          success: true,
          appId: pkce.appId,
          state: s,
          provider: 'godaddy',
        });
      }
    }

    const successPage = renderSuccessPage(state as string, nonce);

    // Clean up PKCE state only after successful exchange
    pkceStateStore.delete(s);

    return res.status(200).send(successPage);
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
      }
    }

    // Always delete PKCE state on exchange failure to prevent replay attacks
    if (s) {
      pkceStateStore.delete(s);
    }

    logger.error('oauth.callback.godaddy.exchange-failed', {
      error: errorMessage,
      state: state as string,
    });

    return res.status(500).send(renderErrorPage('exchange_failed', errorMessage, nonce, state as string));
  }
});

function generateAutoCloseScript(nonce: string): string {
  return `<script nonce="${nonce}">
          (function() {
            let countdown = ${AUTO_CLOSE_COUNTDOWN_SECONDS};

            function closeWindow() {
              try {
                window.close();
              } catch (e) {
                console.error('Failed to close window:', e);
              }

              setTimeout(function() {
                const timer = document.getElementById('timer');
                if (timer) {
                  timer.textContent = 'Please close this window manually.';
                }
              }, ${FALLBACK_MESSAGE_DELAY_MS});
            }

            const countdownEl = document.getElementById('countdown');
            const interval = setInterval(function() {
              countdown--;
              if (countdownEl) {
                countdownEl.textContent = countdown.toString();
              }

              if (countdown <= 0) {
                clearInterval(interval);
                closeWindow();
              }
            }, 1000);

            const button = document.getElementById('close-button');
            if (button) {
              button.addEventListener('click', function() {
                clearInterval(interval);
                closeWindow();
              });
            }
          })();
        </script>`;
}

function renderSuccessPage(state: string, nonce: string): string {
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
          .close-button {
            display: inline-block;
            margin-top: 20px;
            padding: 12px 24px;
            background: #4caf50;
            color: white;
            text-decoration: none;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
          }
          .close-button:hover {
            background: #45a049;
          }
          .timer {
            color: #666;
            font-size: 14px;
            margin-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <div class="checkmark">✓</div>
          <h1>Authentication Successful</h1>
          <p>You have been successfully authenticated with GoDaddy.</p>
          <button class="close-button" id="close-button">Close Window</button>
          <p class="timer" id="timer">This window will close automatically in <span id="countdown">${AUTO_CLOSE_COUNTDOWN_SECONDS}</span> seconds...</p>
        </div>
        ${generateAutoCloseScript(nonce)}
      </body>
    </html>
  `;
}

function renderErrorPage(error: string, description: string | undefined, nonce: string, state?: string): string {
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
            text-align: center;
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
            text-align: left;
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
            text-align: left;
          }
          .close-button {
            display: inline-block;
            margin-top: 20px;
            padding: 12px 24px;
            background: #d32f2f;
            color: white;
            text-decoration: none;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
          }
          .close-button:hover {
            background: #c62828;
          }
          .timer {
            color: #666;
            font-size: 14px;
            margin-top: 15px;
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
        <button class="close-button" id="close-button">Close Window</button>
        <p class="timer" id="timer">This window will close automatically in <span id="countdown">${AUTO_CLOSE_COUNTDOWN_SECONDS}</span> seconds...</p>
        ${generateAutoCloseScript(nonce)}
      </body>
    </html>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;
