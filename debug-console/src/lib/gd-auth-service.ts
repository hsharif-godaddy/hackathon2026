import { GdAuth, SecurityLevel } from '@godaddy/gd-auth-lib';

import { getSsoHost } from '@/lib/sso-host';

/**
 * GoDaddy Auth Service using @godaddy/gd-auth-lib (Rust + NAPI).
 * Handles JWT validation for JOMAX tokens.
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

const DEFAULT_SSO_HOST = 'sso.test-godaddy.com';

function hostFromRequest(request: RequestLike | undefined): string {
    if (!request) return DEFAULT_SSO_HOST;
    return getSsoHost(request.headers.get('host'));
}

export class GdAuthService {
    private gdAuth: GdAuth;

    constructor() {
        this.gdAuth = new GdAuth();
        this.gdAuth.setAppConfig({
            app: 'console.airo-builder',
            client: 'airo-builder.godaddy.com',
            pcpId: '8606',
            testMode: false
        });
    }

    async authenticate(
        token: string,
        request?: RequestLike
    ): Promise<{ valid: boolean; payload?: AuthPayload; reason?: string }> {
        try {
            const ssoHost = hostFromRequest(request);
            const claims = this.gdAuth.parseToken(token, {
                godaddySso: {
                    host: `https://${ssoHost}`,
                    securityLevel: SecurityLevel.NONE,
                    auths: ['basic'],
                    authType: 'jomax',
                    allowHeartbeat: true
                }
            });

            const payload = this.gdAuth.getPayload(claims);
            const isE2S = this.gdAuth.isImpersonation(claims);
            const delegation = isE2S ? this.gdAuth.getDelegationPayload(claims) : null;

            return {
                valid: true,
                payload: {
                    ...payload,
                    shopperId: (isE2S && delegation?.shopperId) ? delegation.shopperId : (this.gdAuth.getShopperId(claims) ?? payload.accountName),
                    cid: (isE2S && delegation?.cid) ? delegation.cid : this.gdAuth.getCustomerId(claims),
                    exp: payload.exp,
                    iat: payload.iat,
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
