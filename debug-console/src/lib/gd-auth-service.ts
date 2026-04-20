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
        accountName: string;
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
        // gd-auth wants a bare hostname, not a URL. We pick which env to talk
        // to based on whether SSO_LOGIN_URL points at the test stack.
        const isTestEnv = (process.env.SSO_LOGIN_URL || '').includes('test')
            || !process.env.SSO_LOGIN_URL;
        this.ssoHost = isTestEnv ? 'sso.test-godaddy.com' : 'sso.godaddy.com';

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
        try {
            const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);
            const isE2S = jwt.auth === 'e2s';

            return {
                valid: true,
                payload: {
                    shopperId: (isE2S && jwt.e2s ? jwt.e2s.shopperId : jwt.shopperId) ?? jwt.accountName,
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
