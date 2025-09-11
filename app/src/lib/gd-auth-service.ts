/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for IDP tokens
 */

const { GdAuth } = require('gd-auth');
import { logger } from '@/lib/request-context';

export class GdAuthService {
  private gdAuth: any;
  private ssoHost: string;

  constructor() {
    // parse the domain from NEXT_PUBLIC_SSO_LOGIN_URL environment variable using robust URL parsing
    try {
      const ssoUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
      this.ssoHost = new URL(ssoUrl).hostname;
    } catch (error) {
      logger.warn('gd-auth.init.sso-url-error', {
        message: 'Invalid SSO URL format, using fallback',
        providedUrl: process.env.NEXT_PUBLIC_SSO_LOGIN_URL,
        fallbackHost: 'sso.test-godaddy.com'
      });
      this.ssoHost = 'sso.test-godaddy.com';
    }

    logger.info('gd-auth.init.sso-host', {
      message: 'Using SSO host',
      ssoHost: this.ssoHost
    });

    // Custom fetchKey with CA certificate for proper SSL validation
    const customFetchKey = (useragent: string, host: string, kid: string) => {
      const fetchKey = require('gd-auth/src/fetch-key');
      const fs = require('fs');
      const path = require('path');

      let httpsOptions = {};

      // Use committed SSO CA certificate
      try {
        const certPath = path.join(process.cwd(), 'certs', 'sso.crt');
        logger.debug('gd-auth.cert.loading', {
          message: 'Attempting to load CA certificate',
          certPath,
          workingDirectory: process.cwd()
        });

        // Check if file exists before reading
        if (!fs.existsSync(certPath)) {
          throw new Error(`Certificate file does not exist: ${certPath}`);
        }

        const certContent = fs.readFileSync(certPath, 'utf8');
        logger.info('gd-auth.cert.loaded', {
          message: 'Certificate loaded successfully',
          certPath,
          contentLength: certContent.length
        });

        httpsOptions = {
          ca: certContent
        };
      } catch (error) {
        logger.error('gd-auth.cert.failed', {
          message: 'Failed to load CA certificate - SSL verification may fail',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
        // Fallback: continue without CA cert (will use system CA store)
      }

      return fetchKey(useragent, host, kid, httpsOptions);
    };

    // Initialize gd-auth with correct parameters for IDP basic auth + heartbeat
    this.gdAuth = new GdAuth({
      app: 'airo-builder',           // Our application name
      type: 'idp',                   // IDP token type
      auths: ['basic'],              // Allowed auth types
      allowHeartbeat: true,          // Enable automatic heartbeat
      fetchKey: customFetchKey       // Custom SSL handling for key fetch
    });
  }

  /**
   * Authenticate token using gd-auth (handles heartbeat automatically)
   */
  async authenticate(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    try {
      logger.info('gd-auth.authenticate.start', 'Authenticating token');

      // Use gd-auth for authentication - it handles heartbeat automatically
      const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);

      logger.info('gd-auth.authenticate.success', {
        message: 'Authentication successful',
        customerId: jwt.cid,
        exp: jwt.exp,
        iat: jwt.iat
      });

      return {
        valid: true,
        payload: {
          shopperId: jwt.shopperId,
          cid: jwt.cid, // Use cid for customerId
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

export const gdAuthService = new GdAuthService();
