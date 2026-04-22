/**
 * GoDaddy Auth Service using @godaddy/gd-auth-lib (Rust + NAPI)
 * Handles JWT validation for JOMAX tokens
 */
import { GdAuth, SecurityLevel } from '@godaddy/gd-auth-lib';

interface AuthPayload {
    shopperId: string;
    cid: string;
    email?: string;
    exp: number;
    iat: number;
    [key: string]: unknown;
}

export class GdAuthService {
    private gdAuth: GdAuth;
    private ssoHost: string;

    constructor() {
        const isTestEnv = (process.env.SSO_LOGIN_URL || '').includes('test')
            || !process.env.SSO_LOGIN_URL;
        this.ssoHost = isTestEnv ? 'sso.test-godaddy.com' : 'sso.godaddy.com';

        this.gdAuth = new GdAuth();
        this.gdAuth.setAppConfig({
            app: 'console.airo-builder',
            client: 'airo-builder.godaddy.com',
            pcpId: '8606',
            testMode: false
        });
    }

    async authenticate(token: string): Promise<{ valid: boolean; payload?: AuthPayload; reason?: string }> {
        try {
            const claims = this.gdAuth.parseToken(token, {
                godaddySso: {
                    host: `https://${this.ssoHost}`,
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
