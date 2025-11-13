/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for IDP tokens
 */

import { logger } from '@/lib/request-context';
import { authUtils } from '@/lib/features';

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
      logger.info('gd-auth.init.sso-host', {
        message: 'Using SSO host',
        ssoHost: this.ssoHost
      });
    } catch (error) {
      logger.warn('gd-auth.init.sso-url-error', {
        message: 'Invalid SSO URL format, using fallback',
        providedUrl: process.env.SSO_LOGIN_URL,
        fallbackHost: 'sso.test-godaddy.com'
      });
      this.ssoHost = 'sso.test-godaddy.com';
    }

    logger.info('gd-auth.init.sso-host', {
      message: 'Using SSO host',
      ssoHost: this.ssoHost
    });

    // Only initialize gd-auth if we're using JWT authentication
    // Check environment variable directly to avoid module loading issues
    const authType = process.env.AUTH_TYPE?.toLowerCase() || 'jwt';
    const isJWTMode = authType === 'jwt' || (process.env.NODE_ENV === 'production' && !authType);

    logger.info('🔍 GdAuthService.constructor.auth-check', {
      message: 'Checking authentication mode',
      authType: authType,
      isJWTMode: isJWTMode,
      nodeEnv: process.env.NODE_ENV,
      willInitializeGdAuth: isJWTMode
    });

    if (isJWTMode) {
      logger.warn('🚨 GdAuthService.constructor.initializing-gd-auth', {
        message: 'About to initialize gd-auth library - this will cause AWS token calls',
        authType: authType,
        nodeEnv: process.env.NODE_ENV
      });
      this.initializeGdAuth();
    } else {
      logger.info('✅ GdAuthService.constructor.skipped', {
        message: 'Skipping gd-auth initialization - no AWS calls will be made',
        authType: authType,
        reason: 'Not using JWT authentication'
      });
      this.gdAuth = null;
    }
  }

  private initializeGdAuth() {
    logger.warn('🚨 GdAuthService.initializeGdAuth.start', {
      message: 'Starting gd-auth initialization - AWS token calls will begin',
      stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });

    const { GdAuth } = require('gd-auth'); // eslint-disable-line @typescript-eslint/no-var-requires

    logger.warn('🚨 GdAuthService.initializeGdAuth.required', {
      message: 'gd-auth module loaded - AWS token manager is now active'
    });


    // Initialize gd-auth with support for multiple auth types including impersonation
    this.gdAuth = new GdAuth({
      app: 'airo-builder',           // Our application name
      type: 'idp',                   // IDP token type
      auths: authUtils.getSupportedAuthTypes(), // Support both basic and e2s (impersonation)
      allowHeartbeat: true,          // Enable automatic heartbeat
      fetchKey: require('gd-auth/src/fetch-key')
    });

    logger.info('gd-auth.init.complete', {
      message: 'GdAuth initialized successfully'
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
        logger.info('gd-auth.authenticate.bypass', {
          message: 'Authentication bypassed',
          authType: authType,
          reason: 'Not using JWT authentication'
        });

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

      logger.info('gd-auth.authenticate.start', 'Authenticating token');

      // Use gd-auth for authentication - it handles heartbeat automatically
      const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);
      const isImpersonation = jwt.auth === 'e2s';

      logger.info('gd-auth.authenticate.success', {
        message: 'Authentication successful',
        customerId: isImpersonation ? jwt.e2s.cid : jwt.cid,
        exp: jwt.exp,
        iat: jwt.iat
      });

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
