/**
 * JWT Validator for Agents
 * Validates JWT tokens using public keys from JWKS endpoint
 */

import { createRequire } from 'module';
import { createPublicKey, type JsonWebKey } from 'node:crypto';
import https from 'node:https';
import type { AuthType, ProductType } from '@airo/shared/auth';

import { getJWTAgentConfig, validateJWTAgentConfig } from './jwks-config.js';
import { auth, getFeatures } from '../services/features.js';
import { logger } from '../logging/index.js';

/**
 * Check if a URL is a local development URL that may use self-signed certificates
 */
function isLocalDevUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' ||
           parsed.hostname === '127.0.0.1' ||
           parsed.hostname.endsWith('.local') ||
           parsed.hostname.includes('local.gasket') ||
           parsed.hostname.includes('.dev-godaddy.com');
  } catch {
    return false;
  }
}

/**
 * Fetch JSON from a URL, with support for self-signed certs in development
 */
async function fetchJson<T>(url: string, timeoutMs: number = 10000, noCache: boolean = false): Promise<T> {
  const features = getFeatures();
  const isDev = features.nodeEnv === 'development';
  const isLocalUrl = isLocalDevUrl(url);

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (noCache) {
    headers['Cache-Control'] = 'no-cache, no-store';
    headers['Pragma'] = 'no-cache';
  }

  // For local dev HTTPS URLs in development mode, accept self-signed certificates
  if (isDev && isLocalUrl && url.startsWith('https://')) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
        rejectUnauthorized: false, // Accept self-signed certs for local dev
        timeout: timeoutMs
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  // For production or non-local URLs, use standard fetch with full SSL verification
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

export interface JWTClaims {
  // Standard JWT claims
  iss: string;      // Issuer
  aud: string;      // Audience
  exp: number;      // Expiration
  iat: number;      // Issued at

  // Custom claims
  siteId: string;          // Site ID
  customerId?: string;     // GoDaddy Customer ID
  canDownload?: boolean;   // Permission to download app files
  canPublish?: boolean;    // Permission to publish app
  canPurchaseDomain?: boolean; // Permission to purchase and attach custom domains
  authType?: AuthType; // Authentication type: basic (normal), e2s (care/employee impersonation), s2s (shopper delegation)
  isE2S?: boolean; // DEPRECATED: Use authType === 'e2s' instead. Only true for e2s (care), NOT s2s (delegation)
  useTestBudget?: boolean; // When true, bypass grants and use test-accounts budget (switchboard: appbuilder-test-budget)
  budgetServiceEnabled?: boolean; // When true, use Budget Service flow instead of legacy grants
  subscriptionId?: string; // Subscription ID for Budget Service API calls
  enableAssessmentAgent?: boolean; // When true, enable assessment agent for prompt classification (switchboard: appbuilder-assessment-agent)
  enableAssessmentOverride?: boolean; // When true, apply budget override from assessment (switchboard: appbuilder-assessment-override). Requires enableAssessmentAgent.
  product?: ProductType; // Product type: 'AiroAppBuilder' (default) or 'PaaSNodeJS'
  modelOverride?: string; // When set, override the default agent model (switchboard: appbuilder-model-override)
  modelSelectorEnabled?: boolean; // When true, allow per-project model selection from frontend (switchboard: appbuilder-model-selector)
  costAttributionDryRun?: boolean; // When true, run cost attribution analysis and log but skip BMS reconciliation (switchboard: appbuilder-cost-attribution-dry-run)
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
      // Use fetchJson which handles self-signed certs for local development
      let jwks = await fetchJson<{ keys: JWK[] }>(this.config.jwksUrl, 10000);
      let jwk = jwks.keys?.find((key) => key.kid === kid);

      // On kid miss, re-fetch once with cache-busting to handle key rotation.
      // Intermediate caches (CDN, proxies) may serve stale JWKS after rotation.
      // A single retry is sufficient: if the JWKS origin doesn't have the key, more retries won't help.
      if (!jwk) {
        logger.info('jwks.key.miss', {
          message: 'Key not found in JWKS, retrying with cache-bust',
          kid,
          jwksUrl: this.config.jwksUrl,
          availableKids: jwks.keys?.map(k => k.kid) ?? []
        });

        jwks = await fetchJson<{ keys: JWK[] }>(this.config.jwksUrl, 10000, true);
        jwk = jwks.keys?.find((key) => key.kid === kid);
      }

      if (!jwk) {
        throw new Error(`Key with kid '${kid}' not found in JWKS`);
      }

      const publicKey = this.jwkToPem(jwk);

      this.keyCache.set(kid, {
        key: publicKey,
        expiresAt: Date.now() + this.cacheTTL
      });

      logger.info('jwks.key.fetched', {
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
