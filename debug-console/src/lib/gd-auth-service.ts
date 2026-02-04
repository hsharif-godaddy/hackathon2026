// Track if we've already logged the bypass warning to avoid log spam
let bypassWarningLogged = false;

/**
 * Check if auth bypass is allowed
 *
 * Security: BYPASS_AUTH is ignored in production to prevent accidental exposure.
 * Only NODE_ENV=development allows bypass, and we log a warning when it happens.
 */
function shouldBypassAuth(): boolean {
    const nodeEnv = process.env.NODE_ENV;
    const bypassAuth = process.env.BYPASS_AUTH;

    // Never allow bypass in production, regardless of BYPASS_AUTH setting
    if (nodeEnv === 'production') {
        if (bypassAuth === 'true' || bypassAuth === '1') {
            console.error('[SECURITY] BYPASS_AUTH is set but ignored in production environment');
        }
        return false;
    }

    // In development, allow bypass
    if (nodeEnv === 'development') {
        return true;
    }

    // For test environment, only allow explicit bypass
    return bypassAuth === 'true' || bypassAuth === '1';
}

/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for JOMAX tokens
 */
interface AuthPayload {
    shopperId: string;
    cid: string;
    email?: string;
    exp: number;
    iat: number;
    [key: string]: unknown;
}

interface GdAuthInstance {
    authenticate(host: string, token: string, options: number): Promise<{
        auth: string;
        shopperId: string;
        cid: string;
        exp: number;
        iat: number;
        payload: Record<string, unknown>;
        e2s?: { shopperId: string; cid: string };
    }>;
}

export class GdAuthService {
    private gdAuth: GdAuthInstance;
    private ssoHost: string;

    constructor() {
        let ssoUrl = process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
        ssoUrl = ssoUrl.includes('test') ? 'sso.test-godaddy.com' : 'sso.godaddy.com';
        try {
            this.ssoHost = new URL(ssoUrl).hostname;
        } catch {
            this.ssoHost = ssoUrl;
        }

        // Lazy import to avoid issues with ES modules
        const { GdAuth } = require('gd-auth'); // eslint-disable-line @typescript-eslint/no-require-imports
        const fetchKey = require('gd-auth/src/fetch-key'); // eslint-disable-line @typescript-eslint/no-require-imports

        this.gdAuth = new GdAuth({
            app: 'console.airo-builder',
            type: 'jomax',
            auths: ['basic'],
            allowHeartbeat: true,
            fetchKey
        });
    }

    async authenticate(token: string): Promise<{ valid: boolean; payload?: AuthPayload; reason?: string }> {
        // Bypass auth in local development
        if (shouldBypassAuth()) {
            if (!bypassWarningLogged) {
                console.warn('[SECURITY] GdAuthService: Authentication bypass enabled. This should only occur in development.');
                bypassWarningLogged = true;
            }
            return {
                valid: true,
                payload: {
                    shopperId: 'local-dev',
                    cid: 'local-dev',
                    email: 'local-dev@localhost',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    iat: Math.floor(Date.now() / 1000)
                }
            };
        }

        try {
            const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);
            const isE2S = jwt.auth === 'e2s';

            return {
                valid: true,
                payload: {
                    shopperId: isE2S && jwt.e2s ? jwt.e2s.shopperId : jwt.shopperId,
                    cid: isE2S && jwt.e2s ? jwt.e2s.cid : jwt.cid,
                    exp: jwt.exp,
                    iat: jwt.iat,
                    ...jwt.payload
                }
            };
        } catch (error: unknown) {
            return {
                valid: false,
                reason: error instanceof Error ? error.message : 'Authentication failed'
            };
        }
    }

    extractTokenFromRequest(request: Request & { cookies?: { get: (name: string) => { value: string } | undefined } }): string | null {
        // In local env, return a dummy token to satisfy the flow
        if (shouldBypassAuth()) {
            return 'local-dev-token';
        }

        const authHeader = request.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        } else if (authHeader?.includes('jomax-jwt ')) {
            return authHeader.split('jomax-jwt ')[1];
        }

        const jomaxCookieToken = request.cookies?.get('auth_jomax')?.value;
        if (jomaxCookieToken) {
            return jomaxCookieToken;
        }

        return null;
    }
}

let _gdAuthService: GdAuthService | null = null;

export const gdAuthService = {
    get instance(): GdAuthService {
        if (!_gdAuthService) {
            _gdAuthService = new GdAuthService();
        }
        return _gdAuthService;
    },

    extractTokenFromRequest(request: Request & { cookies?: { get: (name: string) => { value: string } | undefined } }): string | null {
        return this.instance.extractTokenFromRequest(request);
    },

    async authenticate(token: string) {
        return this.instance.authenticate(token);
    }
};
