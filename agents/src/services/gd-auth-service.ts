/**
 * GD Auth Service for Agents
 * Validates JOMAX tokens using @godaddy/gd-auth-lib (Rust + NAPI)
 */
import { GdAuth, SecurityLevel } from '@godaddy/gd-auth-lib';

import { logger } from '../logging/index.js';

export interface JomaxValidationResult {
  valid: boolean;
  payload?: {
    shopperId: string;
    cid: string;
    exp: number;
    iat: number;
  };
  reason?: string;
}

class GdAuthService {
  private gdAuth: GdAuth;
  private host: string;

  constructor() {
    const ssoHost = this.requireSsoHost();
    this.host = ssoHost.startsWith('https://') ? ssoHost : `https://${ssoHost}`;

    this.gdAuth = new GdAuth();
    this.gdAuth.setAppConfig({
      app: 'airo-builder-agents',
      client: 'airo-builder.godaddy.com',
      pcpId: '8606',
      testMode: false
    });

    logger.info('gd-auth.initialized', { ssoHost, app: 'airo-builder-agents' });
  }

  private requireSsoHost(): string {
    const ssoHost = process.env.SSO_HOST;

    if (!ssoHost) {
      logger.error('gd-auth.config.missing_sso_host', {
        message: 'SSO_HOST environment variable not configured',
        hint: 'Set SSO_HOST to sso.dev-godaddy.com, sso.test-godaddy.com, or sso.godaddy.com',
      });

      throw new Error('SSO_HOST environment variable not configured');
    }

    return ssoHost;
  }

  async authenticate(token: string): Promise<JomaxValidationResult> {
    try {
      const claims = this.gdAuth.parseToken(token, {
        godaddySso: {
          host: this.host,
          securityLevel: SecurityLevel.NONE,
          auths: ['basic'],
          authType: 'jomax'
        }
      });

      const payload = this.gdAuth.getPayload(claims);

      return {
        valid: true,
        payload: {
          shopperId: this.gdAuth.getShopperId(claims) || String(payload.accountName ?? ''),
          cid: this.gdAuth.getCustomerId(claims) ?? '',
          exp: Number(payload.exp),
          iat: Number(payload.iat)
        }
      };
    } catch (error: unknown) {
      logger.warn('gd-auth.authenticate.failed', {
        error: error instanceof Error ? error.message : String(error),
        host: this.host
      });

      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  extractTokenFromRequest(req: { headers?: { authorization?: string } }): string | null {
    const authHeader = req.headers?.authorization;

    if (!authHeader) return null;

    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    if (authHeader.includes('jomax-jwt ')) {
      return authHeader.replace('jomax-jwt ', '');
    }

    return null;
  }
}

// Singleton
let gdAuthServiceInstance: GdAuthService | null = null;

export function getGdAuthService(): GdAuthService {
  if (!gdAuthServiceInstance) {
    gdAuthServiceInstance = new GdAuthService();
  }
  return gdAuthServiceInstance;
}

export const gdAuthService = {
  get instance(): GdAuthService {
    return getGdAuthService();
  }
};
