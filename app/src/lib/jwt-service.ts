/**
 * JWT Service
 * Creates and manages JWT tokens with only siteId and agentUrl custom claims
 */

import jwt from 'jsonwebtoken';
import { getJWTConfig, getJWTConstants, JWTClaims } from './jwt-config';
import { logger } from './request-context';

export interface CreateTokenOptions {
  siteId: string;      // Custom claim
}

export interface TokenResult {
  token: string;
  expires: Date;
}

/**
 * JWT Service - handles token creation and caching
 */
export class JWTService {
  private config = getJWTConfig();
  private constants = getJWTConstants();
  private tokenCache = new Map<string, { token: string; expires: Date }>();

  /**
   * Create JWT token with only siteId custom claim
   */
  async createToken(options: CreateTokenOptions): Promise<TokenResult> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (12 * 60 * 60); // 12 hours from now
    
    const claims: JWTClaims = {
      // Standard claims
      iss: this.constants.issuer,
      aud: this.constants.audience,
      exp,
      iat: now,
      
      // Custom claims (only siteId)
      siteId: options.siteId
    };

    try {
      const token = jwt.sign(claims, this.config.privateKey, {
        algorithm: this.constants.algorithm,
        keyid: this.constants.keyId
      });

      const expires = new Date(exp * 1000);
      
      logger.info('jwt.token.created', {
        siteId: options.siteId,
        expiresAt: expires.toISOString()
      });

      return { token, expires };
      
    } catch (error) {
      logger.error('jwt.token.create.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        siteId: options.siteId
      });
      
      throw new Error(`Failed to create JWT token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get cached token or create new one
   */
  async getToken(options: CreateTokenOptions): Promise<TokenResult> {
    const cacheKey = options.siteId;
    const cached = this.tokenCache.get(cacheKey);
    
    // Check if cached token is still valid (more than 2 hours remaining)
    if (cached && this.isTokenValid(cached.expires, 2 * 60 * 60 * 1000)) {
      return cached;
    }
    
    // Create new token
    const result = await this.createToken(options);
    
    // Cache it
    this.tokenCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Refresh token (create new one and update cache)
   */
  async refreshToken(options: CreateTokenOptions): Promise<TokenResult> {
    const cacheKey = options.siteId;
    
    // Remove old token
    this.tokenCache.delete(cacheKey);
    
    // Create new token
    return this.getToken(options);
  }

  /**
   * Check if token is still valid with buffer time
   */
  private isTokenValid(expires: Date, bufferMs: number): boolean {
    return expires.getTime() > (Date.now() + bufferMs);
  }
}

// Singleton
let jwtServiceInstance: JWTService | null = null;

export function getJWTService(): JWTService {
  if (!jwtServiceInstance) {
    jwtServiceInstance = new JWTService();
  }
  return jwtServiceInstance;
}
