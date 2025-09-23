/**
 * JWT Authentication Middleware for Agents
 * Validates customer JWTs by fetching public keys from SSO (like app does)
 * For dev/test environments where SSO isn't reachable, uses proxy
 */

import { Request, Response, NextFunction } from 'express';
// JWT imported via createRequire to work in ES modules
import fetch from 'node-fetch';

export interface CustomerContext {
  customerId: string;
  shopperId: string;
  accountId?: string;
  siteId: string;
  exp: number;
  iat: number;
}

export interface AuthenticatedRequest extends Request {
  customerContext?: CustomerContext;
}

// Public key cache entry with TTL
interface CachedPublicKey {
  key: string;
  expiresAt: number;
}

export class JWTValidationService {
  private ssoHost: string;
  private proxyUrl: string;
  private isProduction: boolean;
  private publicKeyCache: Map<string, CachedPublicKey> = new Map();
  private readonly PUBLIC_KEY_TTL = 900000; // 15 minutes in milliseconds
  private readonly MAX_CACHE_SIZE = 100; // Prevent memory exhaustion
  private readonly MAX_TOKEN_SIZE = 10000; // 10KB token size limit

  constructor() {
    // Parse the domain from NEXT_PUBLIC_SSO_LOGIN_URL environment variable 
    try {
      const ssoUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
      this.ssoHost = new URL(ssoUrl).hostname;
    } catch (error) {
      console.warn('Invalid SSO URL format, using fallback', process.env.NEXT_PUBLIC_SSO_LOGIN_URL);
      this.ssoHost = 'sso.test-godaddy.com';
    }

    this.proxyUrl = process.env.PROXY_URL || 'http://localhost:8888';
    this.isProduction = process.env.NODE_ENV === 'production';

    console.log('JWT Validation Service initialized:', {
      ssoHost: this.ssoHost,
      proxyUrl: this.proxyUrl,
      environment: process.env.NODE_ENV,
      useProxy: !this.isProduction
    });
  }

  /**
   * Authenticate JWT token - use direct SSO for production, proxy for dev/test
   */
  async authenticate(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    
    if (this.isProduction) {
      // Production: Fetch public key and validate locally (like app does)
      return await this.validateJWTWithPublicKey(token);
    } else {
      // Dev/Test: Use proxy since SSO isn't reachable
      return await this.validateJWTViaProxy(token);
    }
  }

  /**
   * Validate JWT by fetching public key from SSO (production)
   */
  private async validateJWTWithPublicKey(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    try {
      // Load JWT using createRequire for ES modules compatibility
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const jwt = require('jsonwebtoken');

      // Decode JWT header to get kid (key ID)
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
        return { valid: false, reason: 'Invalid JWT format or missing key ID' };
      }

      const kid = decoded.header.kid;

      // Get public key for this kid
      const publicKey = await this.getPublicKey(kid);
      if (!publicKey) {
        return { valid: false, reason: 'Failed to fetch public key' };
      }

      // Verify JWT signature with PEM key
      const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as any;

      return {
        valid: true,
        payload: {
          ...payload
        }
      };

    } catch (error: any) {
      return {
        valid: false,
        reason: this.sanitizeErrorMessage(error)
      };
    }
  }

  /**
   * Get public key from SSO for JWT validation
   */
  private async getPublicKey(kid: string): Promise<string | null> {
    try {
      // Check cache first (with TTL validation)
      const cached = this.publicKeyCache.get(kid);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.key;
      }
      
      // Remove expired entry if exists
      if (cached) {
        this.publicKeyCache.delete(kid);
      }

      // Clean up cache if it gets too large (prevent memory exhaustion)
      if (this.publicKeyCache.size >= this.MAX_CACHE_SIZE) {
        const entries = Array.from(this.publicKeyCache.entries());
        const sortedEntries = entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
        const toRemove = sortedEntries.slice(0, Math.floor(this.MAX_CACHE_SIZE / 2));
        toRemove.forEach(([key]) => this.publicKeyCache.delete(key));
      }

      // Fetch public key from SSO (direct API call)
      const keyUrl = `https://${this.ssoHost}/v1/api/key/${kid}`;

      const response = await fetch(keyUrl, {
        headers: { 'User-Agent': 'airo-agents/1.0.0' }
      });

      if (!response.ok) {
        return null;
      }

      const publicKeyResponse = await response.text();
      
      // Parse JWK and convert to PEM (same as gd-auth does)
      let pemKey;
      try {
        const keyData = JSON.parse(publicKeyResponse);
        if (keyData.data && keyData.data.n && keyData.data.e) {
          // Convert JWK to PEM format - using createRequire for ES modules
          const { createRequire } = await import('module');
          const require = createRequire(import.meta.url);
          const getPem = require('rsa-pem-from-mod-exp');
          pemKey = getPem(keyData.data.n, keyData.data.e);
        } else {
          return null;
        }
      } catch (error) {
        return null;
      }
      
      // Cache the PEM key with TTL
      this.publicKeyCache.set(kid, {
        key: pemKey,
        expiresAt: Date.now() + this.PUBLIC_KEY_TTL
      });

      return pemKey;

    } catch (error: any) {
      return null;
    }
  }

  /**
   * Validate JWT via proxy (dev/test environments)
   */
  private async validateJWTViaProxy(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    try {
      console.log('Validating JWT via proxy');

      const response = await fetch(`${this.proxyUrl}/sso/validate-jwt`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json() as any;

      if (response.ok && result.valid) {
        console.log('JWT validation via proxy successful');
        return {
          valid: true,
          payload: result.payload
        };
      } else {
        return {
          valid: false,
          reason: result.error || 'Token validation via proxy failed'
        };
      }

    } catch (error: any) {
      return {
        valid: false,
        reason: 'Proxy validation failed'
      };
    }
  }

  /**
   * Extract JWT token from request headers  
   * Only supports Authorization header with Bearer token (no cookies due to cross-origin)
   */
  extractTokenFromRequest(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    return null;
  }

  /**
   * Sanitize error messages for security
   */
  sanitizeErrorMessage(error: any): string {
    // Map known JWT errors to safe messages
    if (error.name === 'TokenExpiredError') return 'Token expired';
    if (error.name === 'JsonWebTokenError') return 'Invalid token format';
    if (error.name === 'NotBeforeError') return 'Token not active yet';
    if (error.message?.includes('signature')) return 'Invalid token signature';
    if (error.message?.includes('malformed')) return 'Invalid token format';
    
    // Generic fallback to prevent information leakage
    return 'JWT validation failed';
  }
}

export class JWTAuthMiddleware {
  public jwtValidationService: JWTValidationService;
  private readonly MAX_TOKEN_SIZE = 10000; // 10KB token size limit

  constructor() {
    this.jwtValidationService = new JWTValidationService();
  }

  /**
   * Middleware function to authenticate requests using JWT validation
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Bypass authentication for local development when explicitly disabled
      if (process.env.BYPASS_AUTH_FOR_LOCAL === 'true') {
        console.log('🚨 Authentication bypassed for local development');
        
        // Add mock customer context for local development
        (req as AuthenticatedRequest).customerContext = {
          customerId: 'local-dev-customer',
          shopperId: 'local-dev-shopper',
          accountId: 'local-dev-account',
          siteId: process.env.SITE_ID || 'local-dev-site',
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
          iat: Math.floor(Date.now() / 1000)
        };
        
        next();
        return;
      }

      // Extract JWT token from request
      const token = this.extractTokenFromRequest(req);
      
      if (!token) {
        res.status(401).json({
          error: 'Missing or invalid Authorization header',
          requiresAuth: true
        });
        return;
      }

      // Validate token size to prevent DoS attacks
      if (token.length > this.MAX_TOKEN_SIZE) {
        res.status(401).json({
          error: 'Token too large',
          requiresAuth: true
        });
        return;
      }
      
      // Validate JWT (public key for production, proxy for dev/test)
      const validationResult = await this.jwtValidationService.authenticate(token);
      
      if (!validationResult.valid) {
        res.status(401).json({
          error: this.jwtValidationService.sanitizeErrorMessage({ message: validationResult.reason }),
          requiresAuth: true
        });
        return;
      }
      
      // Extract customer context from validated JWT payload
      const payload = validationResult.payload!;
      const customerContext: CustomerContext = {
        customerId: payload.cid,
        shopperId: payload.shopperId,
        accountId: payload.accountId,
        siteId: this.extractSiteId(req),
        exp: payload.exp,
        iat: payload.iat
      };
      
      // Validate site access if SITE_ID is configured
      const agentSiteId = process.env.SITE_ID;
      if (agentSiteId && customerContext.siteId !== agentSiteId) {
        res.status(403).json({
          error: 'Access denied for this site',
          requestedSite: customerContext.siteId,
          agentSite: agentSiteId
        });
        return;
      }
      
      // Add customer context to request
      (req as AuthenticatedRequest).customerContext = customerContext;
      
      console.log('Customer authentication successful:', {
        customerId: customerContext.customerId,
        shopperId: customerContext.shopperId,
        siteId: customerContext.siteId,
        endpoint: req.path
      });
      
      next();
      
    } catch (error: any) {
      console.error('Authentication error:', error);
      res.status(500).json({
        error: 'Authentication error'
      });
    }
  };

  /**
   * Extract site ID from request context
   * SECURITY: Only use environment SITE_ID to prevent site isolation bypass
   */
  private extractSiteId(req: Request): string {
    // Only use environment SITE_ID - ignore user-controlled params/query
    return process.env.SITE_ID || 'unknown';
  }
}

// Export singleton instance  
export const jwtAuthMiddleware = new JWTAuthMiddleware();

