/**
 * GD Auth Service for Agents
 * Validates JOMAX tokens using gd-auth library
 */
import { createRequire } from 'module';
import { logger } from '../logging/index.js';

// Lazy-load gd-auth to avoid loading it during test imports
let GdAuth: any = null;
let fetchKey: any = null;

function loadGdAuth() {
  if (!GdAuth) {
    const require = createRequire(import.meta.url);
    GdAuth = require('gd-auth').GdAuth;
    fetchKey = require('gd-auth/src/fetch-key');
  }
}

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
  private gdAuth: any;
  private ssoHost: string;

  constructor() {
    this.ssoHost = this.getSsoHost();

    // Lazy-load gd-auth library
    loadGdAuth();

    this.gdAuth = new GdAuth({
      app: 'airo-builder-agents',
      type: 'jomax',
      auths: ['basic'],
      riskLevel: 0,
      fetchKey
    });

    logger.info('gd-auth.initialized', {
      ssoHost: this.ssoHost,
      app: 'airo-builder-agents'
    });
  }

  private getSsoHost(): string {
    const ssoHost = process.env.SSO_HOST;

    if (!ssoHost) {
      // Log detailed error for operators (internal only)
      logger.error('gd-auth.config.missing_sso_host', {
        message: 'SSO_HOST environment variable not configured',
        hint: 'Set SSO_HOST to sso.dev-godaddy.com, sso.test-godaddy.com, or sso.godaddy.com',
      });

      // Throw generic error (could be exposed in logs)
      throw new Error('SSO_HOST environment variable not configured');
    }

    return ssoHost;
  }

  async authenticate(token: string): Promise<JomaxValidationResult> {
    try {
      const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);

      return {
        valid: true,
        payload: {
          shopperId: jwt.shopperId,
          cid: jwt.cid,
          exp: jwt.exp,
          iat: jwt.iat
        }
      };
    } catch (error: unknown) {
      logger.warn('gd-auth.authenticate.failed', {
        error: error instanceof Error ? error.message : String(error),
        ssoHost: this.ssoHost
      });

      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  extractTokenFromRequest(req: { headers?: { authorization?: string } }): string | null {
    const authHeader = req.headers?.authorization;

    if (!authHeader) {return null;}

    // Support "Bearer <token>" or "jomax-jwt <token>"
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
