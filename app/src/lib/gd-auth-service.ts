/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for IDP tokens
 */

import { authUtils } from '@/lib/features';
import { logger } from '@/lib/request-context';

export class GdAuthService {
  private gdAuth: any;
  private ssoHost: string;

  constructor() {
    // Add stack trace to see where this is being called from
    logger.info('🔍 GdAuthService.constructor.called', {
      message: 'GdAuthService constructor called',
      stack: new Error().stack?.split('\n').slice(1, 6).join('\n'),
      authType: process.env.AUTH_TYPE,
      nodeEnv: process.env.NODE_ENV
    });

    // parse the domain from SSO_LOGIN_URL environment variable using robust URL parsing
    try {
      const ssoUrl = process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
      this.ssoHost = new URL(ssoUrl).hostname;
    } catch {
      this.ssoHost = 'sso.test-godaddy.com';
    }

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
    const { GdAuth } = require('gd-auth'); // eslint-disable-line @typescript-eslint/no-var-requires

    // Initialize gd-auth with support for multiple auth types including impersonation
    this.gdAuth = new GdAuth({
      app: 'airo-builder',           // Our application name
      type: 'idp',                   // IDP token type
      auths: authUtils.getSupportedAuthTypes(), // Support both basic and e2s (impersonation)
      allowHeartbeat: true,          // Enable automatic heartbeat
      fetchKey: require('gd-auth/src/fetch-key')
    });
  }

  /**
   * Authenticate token using gd-auth (handles heartbeat automatically)
   */
  async authenticate(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    try {
      // If auth is disabled or not JWT mode, return mock success
      const authType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
      const isJWTMode = authType === 'jwt' || (process.env.NODE_ENV === 'production' && !authType);

      if (!isJWTMode || !this.gdAuth) {
        return {
          valid: true,
          payload: {
            shopperId: 'dev-user',
            cid: 'dev-customer',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000)
          },
          reason: `Authentication bypassed (${authType} mode)`
        };
      }

      // Use gd-auth for authentication - it handles heartbeat automatically
      const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);
      const isImpersonation = jwt.auth === 'e2s';

      return {
        valid: true,
        payload: {
          shopperId: isImpersonation ? jwt.e2s.shopperId : jwt.shopperId,
          cid: isImpersonation ? jwt.e2s.cid : jwt.cid, // Use cid for customerId
          exp: jwt.exp,
          iat: jwt.iat,
          // Include all other JWT payload properties
          ...jwt.payload
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

// Lazy singleton - only create when first accessed at runtime
let _gdAuthService: GdAuthService | null = null;

export const gdAuthService = {
  get instance(): GdAuthService {
    if (!_gdAuthService) {
      logger.info('gd-auth-service.singleton.create', {
        message: 'Creating gdAuthService singleton (lazy)',
        authType: process.env.AUTH_TYPE,
        nodeEnv: process.env.NODE_ENV,
        stack: new Error().stack?.split('\n').slice(1, 6).join('\n')
      });
      _gdAuthService = new GdAuthService();
    }
    return _gdAuthService;
  },

  // Delegate methods for backward compatibility
  extractTokenFromRequest(request: any): string | null {
    return this.instance.extractTokenFromRequest(request);
  },

  async authenticate(token: string) {
    return this.instance.authenticate(token);
  }
};
