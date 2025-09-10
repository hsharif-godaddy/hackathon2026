/**
 * GoDaddy Auth Service using official gd-auth library
 * Handles JWT validation and automatic heartbeat for IDP tokens
 */

const { GdAuth } = require('gd-auth');

export class GdAuthService {
  private gdAuth: any;
  private ssoHost: string;

  constructor() {
    // parse the domain from NEXT_PUBLIC_SSO_LOGIN_URL environment variable using robust URL parsing
    try {
      const ssoUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
      this.ssoHost = new URL(ssoUrl).hostname;
    } catch (error) {
      console.warn(`🔐 [GdAuth] Invalid SSO URL format: ${process.env.NEXT_PUBLIC_SSO_LOGIN_URL}, using fallback`);
      this.ssoHost = 'sso.test-godaddy.com';
    }

    console.log(`🔐 [GdAuth] Using SSO host: ${this.ssoHost}`);

    // Custom fetchKey with CA certificate for proper SSL validation
    const customFetchKey = (useragent: string, host: string, kid: string) => {
      const fetchKey = require('gd-auth/src/fetch-key');
      const fs = require('fs');
      const path = require('path');

      let httpsOptions = {};

      // Use committed SSO CA certificate
      try {
        const certPath = path.join(process.cwd(), 'certs', 'sso.crt');
        console.log(`🔐 [GdAuth] Attempting to load CA certificate from: ${certPath}`);
        console.log(`🔐 [GdAuth] Working directory: ${process.cwd()}`);

        // Check if file exists before reading
        if (!fs.existsSync(certPath)) {
          throw new Error(`Certificate file does not exist: ${certPath}`);
        }

        const certContent = fs.readFileSync(certPath, 'utf8');
        console.log(`🔐 [GdAuth] Certificate loaded successfully (${certContent.length} chars)`);

        httpsOptions = {
          ca: certContent
        };
        console.log(`🔐 [GdAuth] Using CA certificate: ${certPath}`);
      } catch (error) {
        console.error(`❌ [GdAuth] Failed to load CA certificate: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`❌ [GdAuth] This will cause SSL verification to fail`);
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
      console.log('🔐 [GdAuth] Authenticating token...');

      // Use gd-auth for authentication - it handles heartbeat automatically
      const jwt = await this.gdAuth.authenticate(this.ssoHost, token, 0);

      console.log('✅ [GdAuth] Authentication successful');
      console.log('📋 [GdAuth] JWT payload:', {
        shopperId: jwt.shopperId,
        cid: jwt.cid,
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
      console.log('❌ [GdAuth] Authentication failed:', error.message);
      console.log('❌ [GdAuth] Full error object:', JSON.stringify(error, null, 2));

      if (error.ssoCode) {
        console.log('🔍 [GdAuth] SSO error code:', error.ssoCode);
      }

      if (error.code) {
        console.log('🔍 [GdAuth] Error code:', error.code);
      }

      if (error.status) {
        console.log('🔍 [GdAuth] HTTP status:', error.status);
      }

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
