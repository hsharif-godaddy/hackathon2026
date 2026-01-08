/**
 * Check if we're in local development environment
 */
function isLocalEnv(): boolean {
    const nodeEnv = process.env.NODE_ENV;
    const bypassAuth = process.env.BYPASS_AUTH;
    return nodeEnv === 'development' || bypassAuth === 'true' || bypassAuth === '1';
}

/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for JOMAX tokens
 */
export class GdAuthService {
    private gdAuth: any;
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
        const { GdAuth } = require('gd-auth'); // eslint-disable-line @typescript-eslint/no-var-requires
        const fetchKey = require('gd-auth/src/fetch-key'); // eslint-disable-line @typescript-eslint/no-var-requires

        this.gdAuth = new GdAuth({
            app: 'console.airo-builder',
            type: 'jomax',
            auths: ['basic'],
            allowHeartbeat: true,
            fetchKey
        });
    }

    async authenticate(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
        // Bypass auth in local development
        if (isLocalEnv()) {
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
            const isImpersonation = jwt.auth === 'e2s';

            return {
                valid: true,
                payload: {
                    shopperId: isImpersonation ? jwt.e2s.shopperId : jwt.shopperId,
                    cid: isImpersonation ? jwt.e2s.cid : jwt.cid,
                    exp: jwt.exp,
                    iat: jwt.iat,
                    ...jwt.payload
                }
            };
        } catch (error: any) {
            return {
                valid: false,
                reason: error.message || 'Authentication failed'
            };
        }
    }

    extractTokenFromRequest(request: any): string | null {
        // In local env, return a dummy token to satisfy the flow
        if (isLocalEnv()) {
            return 'local-dev-token';
        }

        const authHeader = request.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        } else if (authHeader?.includes('jomax-jwt ')) {
            return authHeader.split('jomax-jwt ')[1];
        }

        const jomaxCookieToken = request.cookies.get('auth_jomax')?.value;
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

    extractTokenFromRequest(request: any): string | null {
        return this.instance.extractTokenFromRequest(request);
    },

    async authenticate(token: string) {
        return this.instance.authenticate(token);
    }
};
