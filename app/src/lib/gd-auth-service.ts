/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for IDP tokens
 */

import { authConfigs, getSsoHostSync } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export class GdAuthService {
  private gdAuth: any;
  private ssoHost: string;

  constructor() {
    // Log service initialization for diagnostics
    logger.debug('gdauth.service.constructor', {
      message: 'GdAuthService initializing',
      authType: process.env.AUTH_TYPE,
      nodeEnv: process.env.NODE_ENV
    });

    this.ssoHost = getSsoHostSync();

    // Only initialize gd-auth if we're using JWT authentication
    const authType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
    const isJWTMode = authType === 'jwt' || (process.env.NODE_ENV === 'production' && !authType);

    if (isJWTMode) {
      this.initializeGdAuth();
    } else {
      this.gdAuth = null;
    }
  }

  private initializeGdAuth() {
    const { GdAuth } = require('gd-auth'); // eslint-disable-line

    // Initialize gd-auth using centralized auth config
    this.gdAuth = new GdAuth({
      app: 'airo-builder',
      type: authConfigs.user.realm,
      auths: authConfigs.user.type,
      allowHeartbeat: authConfigs.user.allowHeartbeat,
      use12HourExpiration: authConfigs.user.use12HourExpiration,
      fetchKey: require('gd-auth/src/fetch-key') // eslint-disable-line @typescript-eslint/no-require-imports
    });
  }

  /**
   * Authenticate token using gd-auth (handles heartbeat automatically)
   */
  async authenticate(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    try {
      // If auth is disabled or not JWT mode, return mock success
      const envAuthType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
      const isJWTMode = envAuthType === 'jwt' || (process.env.NODE_ENV === 'production' && !envAuthType);

      if (!isJWTMode || !this.gdAuth) {
        return {
          valid: true,
          payload: {
            shopperId: 'dev-user',
            cid: 'dev-customer',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            authType: 'basic'
          },
          reason: `Authentication bypassed (${envAuthType} mode)`
        };
      }

      // Use gd-auth for authentication with medium risk level (2)
      // With use12HourExpiration=true, this enforces:
      // - VAT ≤ 5 minutes for basic/s2s tokens (e2s tokens skip VAT check)
      // - IAT ≤ 12 hours for per=true tokens, ≤ 1 hour for per=false
      // - e2s tokens: 2 hour expiration (via verify())
      const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 2);

      // Use gd-auth's built-in methods to extract shopper/customer info
      // These handle all auth types: basic, e2s, s2s, e2s2s, s2snpr, cert2s, etc.
      const shopperId = jwt.getShopperId();
      const cid = jwt.getCustomerId();

      return {
        valid: true,
        payload: {
          // Spread jwt.payload first, then override with extracted values to prevent field overwrites
          ...jwt.payload,
          shopperId,
          cid,
          exp: jwt.exp,
          iat: jwt.iat,
          authType: jwt.auth
        }
      };
    } catch (error: any) {
      const errorData: any = {
        message: error.message
      };

      if (error.ssoCode) errorData.ssoCode = error.ssoCode;
      if (error.code) errorData.code = error.code;
      if (error.status) errorData.status = error.status;

      logger.error('gd-auth.authenticate.error', {
        message: 'Authentication failed',
        ...errorData
      });

      return {
        valid: false,
        reason: error.message || 'Authentication failed'
      };
    }
  }

  /**
   * Get token from request (headers or cookies)
   */
  extractTokenFromRequest(request: any): string | null {
    // Try Authorization header first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    } else if (authHeader?.includes('idp-jwt ')) {
      return authHeader.split('idp-jwt ')[1];
    }

    // Try cookies
    const cookieToken = request.cookies.get('auth_idp')?.value;
    if (cookieToken) {
      return cookieToken;
    }

    return null;
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
        message: 'Creating gdAuthService singleton (lazy)',
        authType: process.env.AUTH_TYPE,
        nodeEnv: process.env.NODE_ENV,
      });
      globalThis.__gdAuthService = new GdAuthService();
    }
    return globalThis.__gdAuthService;
  },

  // Delegate methods for backward compatibility
  extractTokenFromRequest(request: any): string | null {
    return this.instance.extractTokenFromRequest(request);
  },

  async authenticate(token: string) {
    return this.instance.authenticate(token);
  }
};
