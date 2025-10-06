/**
 * JWT Validator for Agents
 * Validates JWT tokens using public key from environment
 */

import { createRequire } from 'module';
import { getJWTAgentConfig, validateJWTAgentConfig } from './jwks-config.js';
import { auth } from '../services/features.js';

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

export class JWTValidator {
  private config: ReturnType<typeof getJWTAgentConfig>;

  constructor() {
    // Validate config on startup
    const configValidation = validateJWTAgentConfig();
    if (!configValidation.valid) {
      throw new Error(`JWT configuration invalid: ${configValidation.errors.join(', ')}`);
    }
    
    this.config = getJWTAgentConfig();
  }

  /**
   * Validate JWT token using the public key from environment
   */
  async validateToken(token: string): Promise<ValidationResult> {
    if (!token) {
      return { valid: false, reason: 'No token provided' };
    }

    try {
      // Verify and decode the JWT using the public key
      const decoded = jwt.verify(token, this.config.publicKey, {
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
   * Validate custom claims (siteId)
   */
  private validateCustomClaims(claims: JWTClaims): ValidationResult {
    if (!claims.siteId) {
      return { valid: false, reason: 'Missing siteId claim' };
    }

    // Optional: Check if siteId matches configured site
    const configuredSiteId = auth.getSiteId();
    if (configuredSiteId && claims.siteId !== configuredSiteId) {
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
      hasPublicKey: !!this.config.publicKey
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
