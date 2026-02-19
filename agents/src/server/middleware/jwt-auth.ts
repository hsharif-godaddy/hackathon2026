/**
 * JWT Authentication Middleware for Agents
 * Validates JWTs using public keys from JWKS endpoint
 */

import { Request, Response, NextFunction } from 'express';
import { getJWTValidator } from '../../lib/jwt-validator.js';
import { validateJWTAgentConfig } from '../../lib/jwks-config.js';
import { auth, AuthType } from '../../services/features.js';
import { logger } from '../../logging/index.js';

export interface AgentContext {
  siteId: string;          // Custom claim
  canDownload: boolean;    // Permission to download app files
  canPublish: boolean;     // Permission to publish app
  canPurchaseDomain?: boolean; // Permission to purchase custom domains
  isE2S: boolean; // true if auth type is 'e2s' (employee-to-shopper)
  exp: number;
  iat: number;
}

export interface AuthenticatedRequest extends Request {
  agentContext?: AgentContext;
}

export class JWTAuthMiddleware {
  private _jwtValidator: ReturnType<typeof getJWTValidator> | null = null;
  private readonly MAX_TOKEN_SIZE = 10000;
  private readonly MAX_WEBSOCKET_TOKEN_TTL_SECONDS = 43200; // 12 hours max for WebSocket tokens

  constructor() {
    // Only validate JWT config if we're using JWT authentication
    // For AUTH_TYPE=none or AUTH_TYPE=mock, JWKS config is not needed
    const authType = auth.getType();
    if (authType === AuthType.JWT) {
      const configValidation = validateJWTAgentConfig();

      if (!configValidation.valid) {
        throw new Error(`JWT configuration invalid: ${configValidation.errors.join(', ')}`);
      }
    }
  }

  /**
   * Lazy getter for JWT validator - only initialized when JWT auth is actually used
   */
  get jwtValidator(): ReturnType<typeof getJWTValidator> {
    if (!this._jwtValidator) {
      this._jwtValidator = getJWTValidator();
    }
    return this._jwtValidator;
  }

  /**
   * Validate token TTL for WebSocket connections
   * WebSocket tokens must have a TTL of 12 hours or less
   *
   * @param claims - JWT claims with exp and iat
   * @returns Validation result with error message if invalid
   */
  validateWebSocketTokenTTL(claims: AgentContext): { valid: boolean; error?: string } {
    const now = Math.floor(Date.now() / 1000);
    const tokenTTL = claims.exp - claims.iat;

    // Check if token has already expired
    if (claims.exp <= now) {
      return { valid: false, error: 'Token has expired' };
    }

    // Check if token TTL exceeds maximum for WebSocket connections
    if (tokenTTL > this.MAX_WEBSOCKET_TOKEN_TTL_SECONDS) {
      return {
        valid: false,
        error: `WebSocket tokens must have TTL of ${this.MAX_WEBSOCKET_TOKEN_TTL_SECONDS} seconds or less (token TTL: ${tokenTTL} seconds)`
      };
    }

    return { valid: true };
  }

  /**
   * Middleware function to authenticate requests
   */
  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Handle different authentication types via feature system
      const authType = auth.getType();

      if (authType === AuthType.NONE) {
        // No authentication required (local development)
        // Grant all permissions for local development
        const now = Math.floor(Date.now() / 1000);
        (req as AuthenticatedRequest).agentContext = {
          siteId: auth.getSiteId(AuthType.NONE),
          canDownload: true,
          canPublish: true,
          canPurchaseDomain: true,
          isE2S: false,
          exp: now + 3600,
          iat: now
        };
        next();
        return;
      }

      if (authType === AuthType.MOCK) {
        // Mock authentication for testing
        // Grant all permissions for testing
        const now = Math.floor(Date.now() / 1000);
        (req as AuthenticatedRequest).agentContext = {
          siteId: auth.getSiteId(AuthType.MOCK),
          canDownload: true,
          canPublish: true,
          canPurchaseDomain: true,
          isE2S: false,
          exp: now + 3600,
          iat: now
        };
        next();
        return;
      }

      // JWT authentication (production)
      if (authType === AuthType.JWT) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          const hasSomeAuth = !!authHeader;
          logger.warn('jwt.auth.missing_bearer', {
            path: req.path,
            method: req.method,
            hasAuthHeader: hasSomeAuth,
            authHeaderLength: hasSomeAuth ? authHeader.length : undefined,
          });
          res.status(401).json({ error: 'Missing Authorization header', requiresAuth: true });
          return;
        }

        const token = authHeader.substring(7);
        if (token.length > this.MAX_TOKEN_SIZE) {
          logger.warn('jwt.auth.token_too_large', {
            path: req.path,
            method: req.method,
            tokenLength: token.length,
            maxSize: this.MAX_TOKEN_SIZE,
          });
          res.status(401).json({ error: 'Token too large', requiresAuth: true });
          return;
        }

        // Validate JWT using public key
        const validationResult = await this.jwtValidator.validateToken(token);

        if (!validationResult.valid || !validationResult.claims) {
          logger.warn('jwt.auth.validation_failed', {
            path: req.path,
            method: req.method,
            reason: validationResult.reason || 'Invalid token',
          });
          res.status(401).json({
            error: validationResult.reason || 'Invalid token',
            requiresAuth: true
          });
          return;
        }

        // Extract context from JWT claims
        const claims = validationResult.claims;
        (req as AuthenticatedRequest).agentContext = {
          siteId: claims.siteId,
          canDownload: claims.canDownload ?? false,
          canPublish: claims.canPublish ?? false,
          canPurchaseDomain: claims.canPurchaseDomain ?? false,
          isE2S: claims.isE2S ?? false,
          exp: claims.exp,
          iat: claims.iat
        };

        next();
        return;
      }

      // Unknown auth type - should not happen
      logger.error('jwt.auth.unknown_type', { authType });
      res.status(500).json({ error: 'Unknown authentication type configured' });

    } catch (error: unknown) {
      logger.error('jwt.auth.error', {
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}

// Lazy singleton instance
let jwtAuthMiddlewareInstance: JWTAuthMiddleware | null = null;

/**
 * Get JWT auth middleware singleton (lazy initialization)
 */
export function getJWTAuthMiddleware(): JWTAuthMiddleware {
  if (!jwtAuthMiddlewareInstance) {
    jwtAuthMiddlewareInstance = new JWTAuthMiddleware();
  }
  return jwtAuthMiddlewareInstance;
}

// Export the lazy getter as the middleware with property access
export const jwtAuthMiddleware = {
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    return getJWTAuthMiddleware().authenticate(req, res, next);
  },
  validateWebSocketTokenTTL: (claims: AgentContext) => {
    return getJWTAuthMiddleware().validateWebSocketTokenTTL(claims);
  },
  get jwtValidator() {
    return getJWTAuthMiddleware().jwtValidator;
  },
  get jwtValidationService() {
    return getJWTAuthMiddleware();
  }
};
