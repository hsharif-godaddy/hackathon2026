/**
 * JWT Validator for Agents
 * Validates JWT tokens using public keys from JWKS endpoint
 */

import { createRequire } from 'module';
import { createPublicKey, type JsonWebKey } from 'node:crypto';
import { getJWTAgentConfig, validateJWTAgentConfig } from './jwks-config.js';
import { auth } from '../services/features.js';
import { logger } from '../logging/index.js';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

export interface JWTClaims {
  // Standard JWT claims
  iss: string;      // Issuer
  aud: string;      // Audience
  exp: number;      // Expiration
  iat: number;      // Issued at
  
  // Custom claims (only siteId)
  siteId: string;   // Site ID
}

export interface ValidationResult {
  valid: boolean;
  claims?: JWTClaims;
  reason?: string;
}

interface JWK extends JsonWebKey {
  kid: string;
  use?: string;
  key_ops?: string[];
  alg?: string;
}

export class JWTValidator {
  private config: ReturnType<typeof getJWTAgentConfig>;
  private keyCache = new Map<string, { key: string; expiresAt: number }>();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Validate config on startup
    const configValidation = validateJWTAgentConfig();
    if (!configValidation.valid) {
      throw new Error(`JWT configuration invalid: ${configValidation.errors.join(', ')}`);
    }
    
    this.config = getJWTAgentConfig();
  }

  /**
   * Validate JWT token using public key from JWKS endpoint
   */
  async validateToken(token: string): Promise<ValidationResult> {
    if (!token) {
      return { valid: false, reason: 'No token provided' };
    }

    try {
      // Get the public key from JWKS endpoint
      const publicKey = await this.getPublicKey(token);

      // Verify and decode the JWT using the public key
      const decoded = jwt.verify(token, publicKey, {
        algorithms: this.config.algorithms,
        issuer: this.config.issuer,
        audience: this.config.audience
      }) as JWTClaims;

      // Validate custom claims
      const customValidation = this.validateCustomClaims(decoded);
      if (!customValidation.valid) {
        return customValidation;
      }

      return {
        valid: true,
        claims: decoded
      };

    } catch (error: unknown) {
      return {
        valid: false,
        reason: this.sanitizeErrorMessage(error)
      };
    }
  }

  /**
   * Get public key for JWT validation by fetching from JWKS endpoint
   */
  private async getPublicKey(token: string): Promise<string> {
    const kid = this.getKeyIdFromToken(token);
    return await this.fetchPublicKeyFromJWKS(kid);
  }

  /**
   * Get key ID from JWT token header
   */
  private getKeyIdFromToken(token: string): string {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      throw new Error('JWT token missing kid in header');
    }
    return decoded.header.kid;
  }

  /**
   * Convert JWK to PEM format using Node.js crypto
   */
  private jwkToPem(jwk: JWK): string {
    const keyObject = createPublicKey({
      key: jwk as JsonWebKey,
      format: 'jwk'
    });
    
    return keyObject.export({
      type: 'spki',
      format: 'pem'
    }) as string;
  }

  /**
   * Fetch public key from JWKS endpoint
   */
  private async fetchPublicKeyFromJWKS(kid: string): Promise<string> {
    const cached = this.keyCache.get(kid);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.key;
    }

    try {
      const response = await fetch(this.config.jwksUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`JWKS endpoint returned ${response.status}`);
      }

      const jwks: { keys: JWK[] } = await response.json();
      const jwk = jwks.keys?.find((key) => key.kid === kid);
      
      if (!jwk) {
        throw new Error(`Key with kid '${kid}' not found in JWKS`);
      }

      const publicKey = this.jwkToPem(jwk);
      
      this.keyCache.set(kid, {
        key: publicKey,
        expiresAt: Date.now() + this.cacheTTL
      });

      logger.info('jwks.key.fetched', {
        message: 'Public key fetched from JWKS',
        kid,
        jwksUrl: this.config.jwksUrl
      });

      return publicKey;

    } catch (error: unknown) {
      logger.error('jwks.fetch.error', {
        message: 'Failed to fetch public key from JWKS',
        kid,
        jwksUrl: this.config.jwksUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Failed to fetch public key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate custom claims (siteId)
   */
  private validateCustomClaims(claims: JWTClaims): ValidationResult {
    if (!claims.siteId) {
      return { valid: false, reason: 'Missing siteId claim' };
    }

    // Optional: Check if siteId matches configured site
    const configuredSiteId = auth.getSiteId();
    const bypassValues = ['bypass-site', 'default-site', 'local-dev-site', 'mock-site-id', 'unknown-site'];
    
    if (configuredSiteId && !bypassValues.includes(configuredSiteId) && claims.siteId !== configuredSiteId) {
      return {
        valid: false,
        reason: `Access denied for site ${claims.siteId}`
      };
    }

    return { valid: true };
  }

  /**
   * Extract JWT token from request headers
   */
  extractTokenFromRequest(req: { headers?: { authorization?: string } }): string | null {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  /**
   * Sanitize error messages for security
   */
  private sanitizeErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; message?: string };
      if (err.name === 'TokenExpiredError') return 'Token expired';
      if (err.name === 'JsonWebTokenError') return 'Invalid token format';
      if (err.name === 'NotBeforeError') return 'Token not active yet';
      if (err.message?.includes('signature')) return 'Invalid token signature';
      if (err.message?.includes('malformed')) return 'Invalid token format';
      if (err.message?.includes('audience')) return 'Invalid token audience';
      if (err.message?.includes('issuer')) return 'Invalid token issuer';
      
      // Return the actual error message for debugging
      return err.message || `${err.name || 'Unknown error'}: No message available`;
    }
    
    return `JWT validation failed: ${String(error)}`;
  }

  /**
   * Get validator configuration for debugging
   */
  getConfig() {
    return {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: this.config.algorithms,
      jwksUrl: this.config.jwksUrl
    };
  }
}

// Singleton instance
let jwtValidatorInstance: JWTValidator | null = null;

export function getJWTValidator(): JWTValidator {
  if (!jwtValidatorInstance) {
    jwtValidatorInstance = new JWTValidator();
  }
  return jwtValidatorInstance;
}
