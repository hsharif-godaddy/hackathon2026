import { getSsoHost } from '@/lib/sso-host';

/**
 * GoDaddy Auth Service using official gd-auth library.
 * Handles JWT validation and automatic heartbeat for JOMAX tokens.
 *
 * Picks the SSO host from the incoming request's FQDN (via getSsoHost) so
 * validation and the /api/auth/refresh heartbeat target the same SSO stack.
 */
interface AuthPayload {
    shopperId: string;
    cid: string;
    email?: string;
    exp: number;
    iat: number;
    [key: string]: unknown;
}

type RequestLike = Request & {
    cookies?: { get: (name: string) => { value: string } | undefined }
};

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

const DEFAULT_SSO_HOST = 'sso.test-godaddy.com';

function hostFromRequest(request: RequestLike | undefined): string {
    if (!request) return DEFAULT_SSO_HOST;
    return getSsoHost(request.headers.get('host'));
}

export class GdAuthService {
    private gdAuth: GdAuthInstance;

    constructor() {
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

    async authenticate(
        token: string,
        request?: RequestLike
    ): Promise<{ valid: boolean; payload?: AuthPayload; reason?: string }> {
        try {
            const ssoHost = hostFromRequest(request);
            const jwt = await this.gdAuth.authenticate(ssoHost, token, 0);
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

    extractTokenFromRequest(request: RequestLike): string | null {
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

    extractTokenFromRequest(request: RequestLike): string | null {
        return this.instance.extractTokenFromRequest(request);
    },

    async authenticate(token: string, request?: RequestLike) {
        return this.instance.authenticate(token, request);
    }
};
