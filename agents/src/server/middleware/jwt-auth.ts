/**
 * JWT Authentication Middleware for Agents
 * Validates customer JWTs by fetching public keys from SSO (like app does)
 */

import { Request, Response, NextFunction } from 'express';
import { createRequire } from 'module';
import getPem from 'rsa-pem-from-mod-exp';
// JWT imported via createRequire to work in ES modules
import fetch from 'node-fetch';

export interface CustomerContext {
  customerId: string;
  accountId?: string;
  siteId: string;
  exp: number;
  iat: number;
}

export interface AuthenticatedRequest extends Request {
  customerContext?: CustomerContext;
  authDetails?: {
    customerId?: string;
    siteId?: string;
    authenticationBypass?: boolean;
    bypassReason?: string;
  };
}

// Public key cache entry with TTL
interface CachedPublicKey {
  key: string;
  expiresAt: number;
}

export class JWTValidationService {
  private ssoHost: string;
  private publicKeyCache: Map<string, CachedPublicKey> = new Map();
  private readonly PUBLIC_KEY_TTL_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

  constructor() {
    this.ssoHost = process.env.AGENT_SSO_HOST || 'sso.test-godaddy.com';
    console.log('JWT Validation Service initialized:', {
      ssoHost: this.ssoHost
    });
  }

  async authenticate(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
    return await this.validateJWTWithPublicKey(token);
  }

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
          const require = createRequire(import.meta.url);
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
        expiresAt: Date.now() + this.PUBLIC_KEY_TTL_MS
      });

      return pemKey;

    } catch (error: any) {
      return null;
    }
  }

  /**
   * Extract JWT token from request headers  
   * Only supports Authorization header with Bearer token (no cookies due to cross-origin)
   */
  extractTokenFromRequest = (req: Request): string | null => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    return null;
  }

  /**
   * Sanitize error messages for security
   */
  sanitizeErrorMessage = (error: any): string => {
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
        // Add mock customer context for local development
        const customerContext: CustomerContext = {
          customerId: 'local-dev-customer',
          accountId: 'local-dev-account',
          siteId: process.env.SITE_ID || 'local-dev-site',
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
          iat: Math.floor(Date.now() / 1000)
        };
        
        (req as AuthenticatedRequest).customerContext = customerContext;
        
        // Add auth details for request logging
        (req as AuthenticatedRequest).authDetails = {
          customerId: customerContext.customerId,
          siteId: customerContext.siteId,
          authenticationBypass: true,
          bypassReason: 'BYPASS_AUTH_FOR_LOCAL enabled for development'
        };
        
        next();
        return;
      }

      // Extract JWT token from request
      const token = this.jwtValidationService.extractTokenFromRequest(req);
      
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
      
      // Add auth details for request logging
      (req as AuthenticatedRequest).authDetails = {
        customerId: customerContext.customerId,
        siteId: customerContext.siteId,
        authenticationBypass: false
      };
      
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

