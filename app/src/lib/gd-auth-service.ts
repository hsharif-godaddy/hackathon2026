/**
 * GoDaddy Auth Service using @godaddy/gd-auth-lib (Rust + NAPI)
 * Server-only - handles JWT validation for IDP tokens.
 *
 * Browser-safe utilities (extractTokenFromRequest, decodeTokenPayload)
 * live in auth-utils.ts to avoid bundling the NAPI module into the client.
 */

import { GdAuth, GdAuthErrorCode, SecurityLevel } from '@godaddy/gd-auth-lib';

import { extractTokenFromRequest as extractToken } from '@/lib/auth-utils';
import { SsoExpirationCode } from '@/lib/features';
import { authConfigs, getSsoHostSync } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

// Re-export browser-safe functions for backward compatibility with existing callers
export { decodeTokenPayload, extractTokenFromRequest } from '@/lib/auth-utils';

// Known authentication error codes that warrant authReason routing
const AUTH_ERROR_CODES = new Set([
  GdAuthErrorCode.TOKEN_EXPIRED,
  GdAuthErrorCode.INVALID_TOKEN_SIGNATURE,
  GdAuthErrorCode.INVALID_TOKEN,
  GdAuthErrorCode.INVALID_AUTH_TYPE,
  GdAuthErrorCode.TOKEN_TYPE_NOT_ALLOWED,
  GdAuthErrorCode.TOKEN_AUTH_RESTRICTED,
]);

export class GdAuthService {
  private gdAuth: GdAuth | null;
  private ssoOptions: Record<number, { godaddySso: { host: string; securityLevel: SecurityLevel; auths: string[]; authType: string; allowHeartbeat: boolean } }>;

  constructor() {
    logger.debug('gdauth.service.constructor', {
      authType: process.env.AUTH_TYPE,
      nodeEnv: process.env.NODE_ENV
    });

    const ssoHost = getSsoHostSync();
    const host = ssoHost.startsWith('https://') ? ssoHost : `https://${ssoHost}`;
    const auths = ['basic', 'e2s', 's2s', 'e2s2s', 'e2s2p', 'e2s2snpr', 'cert2s', 'e2p', 's2p', 's2snpr'];
    const authType = authConfigs.user.realm;
    const allowHeartbeat = authConfigs.user.allowHeartbeat;

    this.ssoOptions = {
      0: { godaddySso: { host, securityLevel: SecurityLevel.NONE, auths, authType, allowHeartbeat } },
      1: { godaddySso: { host, securityLevel: SecurityLevel.LOW, auths, authType, allowHeartbeat } },
      2: { godaddySso: { host, securityLevel: SecurityLevel.MEDIUM, auths, authType, allowHeartbeat } },
      3: { godaddySso: { host, securityLevel: SecurityLevel.HIGH, auths, authType, allowHeartbeat } },
    };

    const envAuthType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
    const isJWTMode = envAuthType === 'jwt' || (process.env.NODE_ENV === 'production' && !envAuthType);

    if (isJWTMode) {
      this.gdAuth = new GdAuth();
      this.gdAuth.setAppConfig({
        app: 'airo-builder',
        client: 'airo-builder.godaddy.com',
        pcpId: '8606',
        testMode: false
      });
    } else {
      this.gdAuth = null;
    }
  }

  async authenticate(token: string, level: 1 | 2 | 3 = 1): Promise<{ valid: boolean; payload?: any; reason?: string; authReason?: number }> {
    try {
      if (!this.gdAuth) {
        return {
          valid: true,
          payload: {
            shopperId: 'dev-user',
            cid: 'dev-customer',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            authType: 'basic'
          },
          reason: `Authentication bypassed (${process.env.AUTH_TYPE} mode)`
        };
      }

      const claims = this.gdAuth.parseToken(token, this.ssoOptions[level]);

      const shopperId = this.gdAuth.getShopperId(claims);
      const cid = this.gdAuth.getCustomerId(claims);
      const payload = this.gdAuth.getPayload(claims);

      return {
        valid: true,
        payload: {
          ...payload,
          shopperId,
          cid,
          authType: payload.auth || 'basic'
        }
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (error as { code?: number }).code;

      logger.error('gd-auth.authenticate.error', {
        message: 'Authentication failed',
        errorMessage: err.message,
        ...(code !== undefined ? { code } : {})
      });

      // Only set authReason for known auth failures (token expired, invalid signature, etc.)
      // Transient errors (network timeout, key fetch failure) return plain 401 without authReason
      // so the client doesn't spuriously redirect to /login.
      if (code !== undefined && AUTH_ERROR_CODES.has(code)) {
        // Level 3 (HIGH) checks HBI claim -> authReason 2 routes client to /hbi.
        // All other auth failures -> authReason 1 routes client to /login.
        const authReason = (code === GdAuthErrorCode.TOKEN_EXPIRED && level === 3)
          ? SsoExpirationCode.HBI
          : SsoExpirationCode.LOGIN;

        return {
          valid: false,
          reason: err.message || 'Authentication failed',
          authReason
        };
      }

      return {
        valid: false,
        reason: err.message || 'Authentication failed'
      };
    }
  }

  extractTokenFromRequest(request: any): string | null {
    return extractToken(request);
  }
}

// Lazy singleton using globalThis to survive Next.js hot module reloading
declare global {
  interface GlobalThis {
    __gdAuthService?: GdAuthService;
  }
}

export const gdAuthService = {
  get instance(): GdAuthService {
    if (!globalThis.__gdAuthService) {
      logger.info('gd-auth-service.singleton.create', {
        authType: process.env.AUTH_TYPE,
        nodeEnv: process.env.NODE_ENV,
      });
      globalThis.__gdAuthService = new GdAuthService();
    }
    return globalThis.__gdAuthService;
  },

  extractTokenFromRequest(request: any): string | null {
    return this.instance.extractTokenFromRequest(request);
  },

  async authenticate(token: string, level?: 1 | 2 | 3) {
    return this.instance.authenticate(token, level);
  }
};
