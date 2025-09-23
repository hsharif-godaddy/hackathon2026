import express, { Request, Response, Router } from 'express';
import * as jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import logger from '../utils/logger';
import { config } from '../config';

const router: Router = express.Router();

// Public key cache entry with TTL  
interface CachedPublicKey {
  key: any; // Can be string (PEM) or object (JWK)
  expiresAt: number;
}

// Cache for public keys to avoid repeated fetches
const publicKeyCache = new Map<string, CachedPublicKey>();
const PUBLIC_KEY_TTL = 900000; // 15 minutes in milliseconds
const MAX_CACHE_SIZE = 100; // Prevent memory exhaustion

/**
 * Get public key from SSO for JWT validation
 */
async function getPublicKey(kid: string): Promise<string | null> {
  try {
    // Check cache first (with TTL validation)
    const cached = publicKeyCache.get(kid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.key;
    }

    // Remove expired entry if exists
    if (cached) {
      publicKeyCache.delete(kid);
    }

    // Clean up cache if it gets too large (prevent memory exhaustion)
    if (publicKeyCache.size >= MAX_CACHE_SIZE) {
      const entries = Array.from(publicKeyCache.entries());
      const sortedEntries = entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toRemove = sortedEntries.slice(0, Math.floor(MAX_CACHE_SIZE / 2));
      toRemove.forEach(([key]) => publicKeyCache.delete(key));
    }

    // Extract host from SSO endpoint and construct public key URL
    const ssoUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
    const ssoHost = new URL(ssoUrl).hostname;
    const keyUrl = `https://${ssoHost}/v1/api/key/${kid}`;

    const response = await fetch(keyUrl, {
      headers: { 'User-Agent': 'airo-proxy/2.0.0' }
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
        // Convert JWK to PEM format - exact same as gd-auth
        const getPem = require('rsa-pem-from-mod-exp');
        pemKey = getPem(keyData.data.n, keyData.data.e);
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
    
    // Cache the PEM key with TTL
    publicKeyCache.set(kid, {
      key: pemKey,
      expiresAt: Date.now() + PUBLIC_KEY_TTL
    });

    return pemKey;

  } catch (error: any) {
    return null;
  }
}

/**
 * Validate JWT token using public key from SSO
 */
async function validateJWT(token: string): Promise<{ valid: boolean; payload?: any; reason?: string }> {
  try {
    // Decode JWT header to get kid (key ID)
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      return { valid: false, reason: 'Invalid JWT format or missing key ID' };
    }

    const kid = decoded.header.kid;

    // Get public key for this kid
    const publicKey = await getPublicKey(kid);
    if (!publicKey) {
      return { valid: false, reason: 'Failed to fetch public key from SSO' };
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
    // Return actual error for debugging 
    return {
      valid: false,
      reason: error.message || 'JWT validation failed'
    };
  }
}

/**
 * SSO JWT Validation endpoint for agents
 * POST /validate-jwt
 * Authorization: Bearer <customer-jwt>
 */
router.post('/validate-jwt', async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as any).id || 'sso-' + Date.now();
  const startTime = Date.now();
  
  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        valid: false,
        error: 'Missing or invalid Authorization header'
      });
      return;
    }
    
    const token = authHeader.substring(7);
    
    if (!token) {
      res.status(401).json({
        valid: false,
        error: 'Empty token provided'
      });
      return;
    }

    // Validate token size to prevent DoS attacks
    if (token.length > 10000) { // 10KB limit
      res.status(401).json({
        valid: false,
        error: 'Token too large'
      });
      return;
    }
    
    // Validate JWT using public key from SSO
    const validationResult = await validateJWT(token);
    
    const duration = Date.now() - startTime;
    
    if (validationResult.valid && validationResult.payload) {
      logger.info('SSO JWT validation successful', {
        requestId,
        duration: `${duration}ms`
      });
      
      res.status(200).json({
        valid: true,
        payload: validationResult.payload
      });
    } else {
      logger.warn('SSO JWT validation failed', {
        requestId,
        reason: validationResult.reason,
        duration: `${duration}ms`
      });
      
      res.status(401).json({
        valid: false,
        error: validationResult.reason || 'Invalid or expired token'
      });
    }
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error('SSO JWT validation error', {
      requestId,
      error: error.message,
      duration: `${duration}ms`
    });
    
    res.status(500).json({
      valid: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Health check for SSO validation service
 * GET /health
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    service: 'sso-validation',
    timestamp: new Date().toISOString(),
    proxy_port: process.env.PORT || '8888'
  });
});

export default router;
