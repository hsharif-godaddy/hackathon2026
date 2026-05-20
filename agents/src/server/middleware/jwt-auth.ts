/**
 * JWT Authentication Middleware for Agents
 * Validates JWTs using public keys from JWKS endpoint
 */

import { Request, Response, NextFunction } from 'express';
import type { AuthType as TokenAuthType, ProductType } from '@airo/shared/auth';

import { getJWTValidator } from '../../lib/jwt-validator.js';
import { validateJWTAgentConfig } from '../../lib/jwks-config.js';
import { auth, AuthType } from '../../services/features.js';
import { logger } from '../../logging/index.js';
import { ClassifierMode } from '../../agents/assessment-agent/types.js';

export type { ProductType };

/**
 * Coerce a raw product claim to a valid ProductType.
 * Only 'PaaSNodeJS' is preserved; everything else (unknown, missing, undefined)
 * falls back to 'AiroAppBuilder'.
 */
export function coerceProductType(raw: string | undefined | null): ProductType {
  return raw === 'PaaSNodeJS' ? 'PaaSNodeJS' : 'AiroAppBuilder';
}

/**
 * Coerce a raw classifier claim to a valid ClassifierMode.
 * Unknown or missing values return undefined (agents default to ClassifierMode.CosineSimilarity).
 */
function coerceClassifierMode(raw: string | undefined | null): ClassifierMode | undefined {
  if (raw === ClassifierMode.LogisticRegression) return ClassifierMode.LogisticRegression;
  if (raw === ClassifierMode.CosineSimilarity) return ClassifierMode.CosineSimilarity;
  return undefined;
}

export interface AgentContext {
  siteId: string;          // Custom claim
  customerId?: string;     // GoDaddy Customer ID
  visitorId?: string;
  trafficSessionId?: string;
  canDownload: boolean;    // Permission to download app files
  canPublish: boolean;     // Permission to publish app
  canPurchaseDomain?: boolean; // Permission to purchase and attach custom domains
  isE2S: boolean; // deprecated: use authType === 'e2s' instead. Only true for e2s (care), NOT s2s (delegation)
  authType?: TokenAuthType; // Authentication type
  useTestBudget?: boolean; // Bypass grants and use test-accounts budget
  budgetServiceEnabled?: boolean; // Use Budget Service flow instead of legacy grants
  subscriptionId?: string; // Subscription ID for Budget Service API calls
  bmsBudgetId?: string; // BMS budget ID for cost allocation (undefined = cost to GoDaddy)
  enableAssessmentAgent?: boolean; // Enable assessment agent for prompt classification
  enableAssessmentOverride?: boolean; // Apply budget override from assessment (requires enableAssessmentAgent)
  assessmentClassifier?: ClassifierMode; // Which classifier to use (switchboard: appbuilder-assessment-classifier)
  product: ProductType;    // Product type: 'AiroAppBuilder' (default) or 'PaaSNodeJS'
  modelOverride?: string; // Override the default agent model (switchboard: appbuilder-model-override)
  modelSelectorEnabled?: boolean; // Allow per-project model selection from frontend (switchboard: appbuilder-model-selector)
  agentProfile?: string; // Active agent profile identifier
  agentProfileSelectorEnabled?: boolean; // Allow per-project agent profile selection from frontend
  useAtlasCrawler?: boolean; // Route rebuild scraping through Atlas REST API instead of legacy WebsiteScraperDriver (switchboard: appbuilder-atlas-crawler)
  debugStatsEnabled?: boolean; // Allow per-LLM-call debug stats events to flow to this client (switchboard: appbuilder-debug-drawer)
  googleReviewsEnabled?: boolean; // Enable Google Reviews feature (switchboard: appbuilder-google-reviews)
  exp: number;
  iat: number;
}

export interface AuthenticatedRequest extends Request {
  agentContext?: AgentContext;
}

/**
 * Build an AgentContext from raw JWT claims.
 * Single source of truth — used by HTTP middleware, WebSocket auth, and token refresh.
 */
export function buildAgentContext(raw: Record<string, unknown>): AgentContext {
  return {
    siteId: (raw.siteId as string) || '',
    customerId: raw.customerId as string | undefined,
    visitorId: typeof raw.visitorId === 'string' && raw.visitorId.length > 0 ? raw.visitorId : undefined,
    trafficSessionId:
      typeof raw.trafficSessionId === 'string' && raw.trafficSessionId.length > 0
        ? raw.trafficSessionId
        : undefined,
    canDownload: (raw.canDownload as boolean) ?? false,
    canPublish: (raw.canPublish as boolean) ?? false,
    canPurchaseDomain: (raw.canPurchaseDomain as boolean) ?? false,
    isE2S: (raw.isE2S as boolean) ?? false,
    authType: (raw.authType as TokenAuthType) ?? 'basic',
    useTestBudget: (raw.useTestBudget as boolean) ?? false,
    budgetServiceEnabled: (raw.budgetServiceEnabled as boolean) ?? false,
    subscriptionId: raw.subscriptionId as string | undefined,
    bmsBudgetId: raw.bmsBudgetId as string | undefined,
    enableAssessmentAgent: (raw.enableAssessmentAgent as boolean) ?? false,
    enableAssessmentOverride: (raw.enableAssessmentOverride as boolean) ?? false,
    assessmentClassifier: coerceClassifierMode(raw.assessmentClassifier as string | undefined),
    product: coerceProductType(raw.product as string | undefined),
    modelOverride: raw.modelOverride as string | undefined,
    modelSelectorEnabled: (raw.modelSelectorEnabled as boolean) ?? false,
    agentProfile: raw.agentProfile as string | undefined,
    agentProfileSelectorEnabled: (raw.agentProfileSelectorEnabled as boolean) ?? false,
    useAtlasCrawler: (raw.useAtlasCrawler as boolean) ?? false,
    debugStatsEnabled: (raw.debugStatsEnabled as boolean) ?? false,
    googleReviewsEnabled: (raw.googleReviewsEnabled as boolean) ?? false,
    exp: (raw.exp as number) || 0,
    iat: (raw.iat as number) || 0,
  };
}

export class JWTAuthMiddleware {
  private _jwtValidator: ReturnType<typeof getJWTValidator> | null = null;
  private readonly MAX_TOKEN_SIZE = 10000;
  private readonly MAX_WEBSOCKET_TOKEN_TTL_SECONDS = 43200; // 12 hours max for WebSocket tokens

  constructor() {
    // Only validate JWT config if we're using JWT authentication
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

      if (authType === AuthType.MOCK) {
        const now = Math.floor(Date.now() / 1000);
        (req as AuthenticatedRequest).agentContext = {
          siteId: auth.getSiteId(AuthType.MOCK),
          canDownload: true,
          canPublish: true,
          canPurchaseDomain: true,
          isE2S: false,
          product: 'AiroAppBuilder',
          modelSelectorEnabled: true,
          agentProfileSelectorEnabled: true,
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

        const agentContext = buildAgentContext(validationResult.claims as unknown as Record<string, unknown>);

        if (agentContext.budgetServiceEnabled && !agentContext.subscriptionId) {
          logger.warn('jwt-auth.budget-service.missing-subscription-id', {
            siteId: agentContext.siteId,
          });
          agentContext.budgetServiceEnabled = false;
        }

        (req as AuthenticatedRequest).agentContext = agentContext;

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
