#!/usr/bin/env tsx
/**
 * OAuth PKCE Flow Test Script
 *
 * Tests the complete OAuth2 Authorization Code Flow with PKCE:
 * 1. Initiates authentication with AuthService.getAccessToken()
 * 2. Catches AuthRequiredError and displays OAuth URL
 * 3. Starts temporary HTTP server to receive callback
 * 4. Waits for user to authenticate in browser
 * 5. Exchanges authorization code for tokens via AuthService.exchangeCode()
 * 6. Displays tokens and validates storage
 *
 * Usage:
 *   pnpm tsx agents/scripts/test-oauth-flow.ts
 *
 * Environment variables required:
 *   GODADDY_OAUTH_CLIENT_ID - OAuth client ID for testing
 *   GODADDY_API_BASE_URL - OAuth API base URL (default: https://api.dev-godaddy.com)
 *   GODADDY_OAUTH_ENCRYPTION_KEY - Token encryption key (generate with: openssl rand -base64 32)
 */

import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';
import { AuthService, AuthRequiredError } from '../src/services/auth-service.js';
import { TokenStore } from '../src/services/token-store.js';
// Initialize database connection and schema
import { getDatabase } from '../src/database/connection.js';

/**
 * Decode JWT payload without verification (for display purposes only)
 */
function decodeJWT(token: string): any {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }
        const payload = parts[1];
        const decoded = Buffer.from(payload, 'base64url').toString('utf8');
        return JSON.parse(decoded);
    } catch (err) {
        return null;
    }
}

const PORT = 4000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/godaddy/callback`;

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logStep(step: number, message: string) {
    log(`\n${colors.bright}[Step ${step}]${colors.reset} ${message}`);
}

function logSuccess(message: string) {
    log(`✓ ${message}`, colors.green);
}

function logError(message: string) {
    log(`✗ ${message}`, colors.red);
}

function logInfo(message: string) {
    log(`ℹ ${message}`, colors.cyan);
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): void {
    const required = ['GODADDY_OAUTH_CLIENT_ID', 'GODADDY_OAUTH_CLIENT_SECRET', 'GODADDY_OAUTH_ENCRYPTION_KEY'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        logError(`Missing required environment variables: ${missing.join(', ')}`);
        console.log('\nPlease set:');
        if (missing.includes('GODADDY_OAUTH_CLIENT_ID')) {
            console.log('  GODADDY_OAUTH_CLIENT_ID=<your-client-id>');
        }
        if (missing.includes('GODADDY_OAUTH_CLIENT_SECRET')) {
            console.log('  GODADDY_OAUTH_CLIENT_SECRET=<your-client-secret>');
        }
        if (missing.includes('GODADDY_OAUTH_ENCRYPTION_KEY')) {
            console.log('  GODADDY_OAUTH_ENCRYPTION_KEY=$(openssl rand -base64 32)');
        }
        process.exit(1);
    }

    // Set defaults for optional env vars
    if (!process.env.GODADDY_API_BASE_URL) {
        process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com';
    }
    if (!process.env.OAUTH_REDIRECT_URI) {
        process.env.OAUTH_REDIRECT_URI = REDIRECT_URI;
    }
}

/**
 * Start temporary HTTP server to receive OAuth callback
 */
function startCallbackServer(): Promise<{ code: string; state: string; server: http.Server }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url || '', `http://localhost:${PORT}`);

            if (url.pathname === '/oauth/godaddy/callback') {
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');
                const errorDescription = url.searchParams.get('error_description');

                if (error) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                            <head><title>Authentication Failed</title></head>
                            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
                                <h1 style="color: #d32f2f;">Authentication Failed</h1>
                                <p><strong>Error:</strong> ${error}</p>
                                <p>${errorDescription || 'Unknown error occurred'}</p>
                                <p>You can close this window.</p>
                            </body>
                        </html>
                    `);
                    reject(new Error(`OAuth error: ${error} - ${errorDescription}`));
                    return;
                }

                if (!code || !state) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Missing code or state parameter');
                    reject(new Error('Missing code or state parameter'));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <head><title>Authentication Successful</title></head>
                        <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                            <div style="background: #e8f5e9; padding: 20px; border-radius: 4px; margin: 20px 0;">
                                <div style="font-size: 48px; color: #2e7d32;">✓</div>
                                <h1 style="color: #2e7d32;">Authentication Successful</h1>
                                <p>Authorization code received. Return to your terminal.</p>
                                <p>You can close this window.</p>
                            </div>
                        </body>
                    </html>
                `);

                resolve({ code, state, server });
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        server.listen(PORT, () => {
            logSuccess(`Callback server listening on http://localhost:${PORT}`);
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Main test function
 */
async function main() {
    log(`\n${colors.bright}OAuth PKCE Flow Test${colors.reset}`, colors.blue);
    log('='.repeat(50));

    // Initialize database (ensures schema is created)
    getDatabase();

    // Step 1: Validate environment
    logStep(1, 'Validating environment variables');
    try {
        validateEnvironment();
        logSuccess('Environment validated');
        logInfo(`API URL: ${process.env.GODADDY_API_BASE_URL}`);
        logInfo(`Client ID: ${process.env.GODADDY_OAUTH_CLIENT_ID}`);
        logInfo(`Redirect URI: ${REDIRECT_URI}`);
    } catch (err) {
        logError('Environment validation failed');
        throw err;
    }

    // Step 2: Start callback server
    logStep(2, 'Starting OAuth callback server');
    const serverPromise = startCallbackServer();

    // Step 3: Initiate OAuth flow
    logStep(3, 'Initiating OAuth flow with AuthService');
    const testAppId = `test-app-${Date.now()}`;
    const testScopes = ['commerce.product:read'];

    let authUrl: string;
    let authState: string;

    try {
        await AuthService.getAccessToken({
            appId: testAppId,
            scopes: testScopes,
            redirectUri: REDIRECT_URI,
        });
        // Should not reach here
        logError('Expected AuthRequiredError but got success');
        process.exit(1);
    } catch (err) {
        if (err instanceof AuthRequiredError) {
            logSuccess('AuthRequiredError thrown as expected');
            authUrl = err.redirectUrl;
            authState = err.state;

            log(`\n${colors.yellow}${colors.bright}Please authenticate in your browser:${colors.reset}`);
            log(`${colors.cyan}${authUrl}${colors.reset}\n`);
            logInfo('Waiting for callback...');
        } else {
            logError(`Unexpected error: ${err}`);
            throw err;
        }
    }

    // Step 4: Wait for callback
    logStep(4, 'Waiting for OAuth callback');
    let callbackResult: { code: string; state: string; server: http.Server };
    try {
        callbackResult = await serverPromise;
        logSuccess(`Callback received with code: ${callbackResult.code.substring(0, 20)}...`);
        logSuccess(`State matches: ${callbackResult.state === authState}`);
    } catch (err) {
        logError(`Callback failed: ${err}`);
        throw err;
    }

    // Step 5: Exchange code for tokens
    logStep(5, 'Exchanging authorization code for tokens');
    let exchangeResult: { accessToken: string; expiresAt: number };
    try {
        exchangeResult = await AuthService.exchangeCode({
            code: callbackResult.code,
            state: callbackResult.state,
        });

        logSuccess('Token exchange successful!');
        
        // Decode JWT to show claims
        const claims = decodeJWT(exchangeResult.accessToken);
        
        log(`\n${colors.bright}Access Token:${colors.reset}`);
        log(`  ${exchangeResult.accessToken.substring(0, 50)}...`);
        
        if (claims) {
            log(`\n${colors.bright}Token Claims:${colors.reset}`);
            if (claims.sub) {
                log(`  ${colors.cyan}Subject (sub):${colors.reset} ${claims.sub}`);
            }
            if (claims.iss) {
                log(`  Issuer: ${claims.iss}`);
            }
            if (claims.aud) {
                log(`  Audience: ${claims.aud}`);
            }
            if (claims.scope) {
                log(`  Scopes: ${claims.scope}`);
            }
            if (claims.exp) {
                const expDate = new Date(claims.exp * 1000);
                log(`  Token Expires: ${expDate.toISOString()}`);
            }
        }
        
        log(`\n${colors.bright}Expires At:${colors.reset}`);
        log(`  ${new Date(exchangeResult.expiresAt).toISOString()}`);
        log(`  (${Math.floor((exchangeResult.expiresAt - Date.now()) / 60000)} minutes from now)`);
    } catch (err) {
        logError(`Token exchange failed: ${err}`);
        throw err;
    }

    // Step 6: Verify token in storage
    logStep(6, 'Verifying token stored correctly');
    let storedToken: any;
    try {
        storedToken = TokenStore.findValid({
            appId: testAppId,
            provider: 'godaddy',
            scopes: testScopes.sort().join(' '),
        });

        if (storedToken) {
            logSuccess('Token found in storage');
            logSuccess(`Token expires at: ${new Date(storedToken.expiresAt).toISOString()}`);
            if (storedToken.refreshToken) {
                logSuccess('Refresh token present');
            } else {
                logInfo('No refresh token (may be normal depending on scope)');
            }
        } else {
            logError('Token not found in storage!');
            process.exit(1);
        }
    } catch (err) {
        logError(`Storage verification failed: ${err}`);
        throw err;
    }

    // Step 7: Test token retrieval (should return cached token)
    logStep(7, 'Testing cached token retrieval');
    try {
        const cachedResult = await AuthService.getAccessToken({
            appId: testAppId,
            scopes: testScopes,
        });

        logSuccess('Cached token retrieved without re-authentication');
        logSuccess(`Token matches: ${cachedResult.accessToken === storedToken?.accessToken}`);
    } catch (err) {
        logError(`Cached token retrieval failed: ${err}`);
        throw err;
    }

    // Cleanup
    log(`\n${colors.bright}${colors.green}✓ All tests passed!${colors.reset}`);
    log('\nCleaning up...');
    callbackResult.server.close(() => {
        logSuccess('Callback server stopped');
        process.exit(0);
    });
}

// Run the test
main().catch((err) => {
    logError(`\nTest failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
