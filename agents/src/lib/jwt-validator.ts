/**
 * JWT Validator for Agents
 * Validates JWT tokens using public keys from JWKS endpoint
 */

import { createRemoteJWKSet, jwtVerify, errors as joseErrors, customFetch } from 'jose';
import type { FetchImplementation } from 'jose/jwks/remote';
import type { FlattenedJWSInput, JWSHeaderParameters } from 'jose';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import type { AuthType, ProductType } from '@airo/shared/auth';

import { getJWTAgentConfig, validateJWTAgentConfig } from './jwks-config.js';
import { auth, getFeatures, BYPASS_SITE_IDS } from '../services/features.js';

const JWKS_TIMEOUT_MS = 30_000;
const JWKS_CACHE_MAX_AGE_MS = 60 * 60_000;
const JWKS_COOLDOWN_MS = 30_000;

function isLocalDevUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' ||
           hostname === '127.0.0.1' ||
           hostname.endsWith('.local') ||
           hostname.includes('local.gasket') ||
           hostname.includes('.dev-godaddy.com');
  } catch {
    return false;
  }
}

export interface JWTClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;

  siteId: string;
  customerId?: string;
  visitorId?: string;
  trafficSessionId?: string;
  canDownload?: boolean;
  canPublish?: boolean;
  canPurchaseDomain?: boolean;
  authType?: AuthType;
  isE2S?: boolean;
  useTestBudget?: boolean;
  budgetServiceEnabled?: boolean;
  subscriptionId?: string;
  enableAssessmentAgent?: boolean;
  enableAssessmentOverride?: boolean;
  product?: ProductType;
  modelOverride?: string;
  modelSelectorEnabled?: boolean;
  costAttributionDryRun?: boolean;
  useAtlasCrawler?: boolean;
  debugStatsEnabled?: boolean;
  marketingCampaignsEnabled?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  claims?: JWTClaims;
  reason?: string;
}

type JWKSResolver = (header?: JWSHeaderParameters, input?: FlattenedJWSInput) => Promise<CryptoKey>;

export class JWTValidator {
  private config: ReturnType<typeof getJWTAgentConfig>;
  private jwks: JWKSResolver;

  constructor() {
    const configValidation = validateJWTAgentConfig();
    if (!configValidation.valid) {
      throw new Error(`JWT configuration invalid: ${configValidation.errors.join(', ')}`);
    }

    this.config = getJWTAgentConfig();

    let devFetch: FetchImplementation | undefined;
    if (
      getFeatures().nodeEnv === 'development'
      && this.config.jwksUrl.startsWith('https://')
      && isLocalDevUrl(this.config.jwksUrl)
    ) {
      // nosemgrep: bypass-tls-verification -- gated to dev + local host + https; used only to accept self-signed certs on local.gasket.dev-godaddy.com during local development
      const dispatcher = new UndiciAgent({ connect: { rejectUnauthorized: false } });
      devFetch = ((url, options) =>
        // undici's Response type lacks `bytes()` that lib.dom requires; cast is safe for jose's use
        undiciFetch(url, { ...options, dispatcher }) as unknown as Promise<Response>) as FetchImplementation;
    }

    this.jwks = createRemoteJWKSet(new URL(this.config.jwksUrl), {
      timeoutDuration: JWKS_TIMEOUT_MS,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      ...(devFetch ? { [customFetch]: devFetch } : {}),
    });
  }

  async validateToken(token: string): Promise<ValidationResult> {
    if (!token) {
      return { valid: false, reason: 'No token provided' };
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: this.config.algorithms,
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      const claims = payload as unknown as JWTClaims;
      const customValidation = this.validateCustomClaims(claims);
      if (!customValidation.valid) {
        return customValidation;
      }

      return { valid: true, claims };
    } catch (error: unknown) {
      return { valid: false, reason: this.sanitizeErrorMessage(error) };
    }
  }

  private validateCustomClaims(claims: JWTClaims): ValidationResult {
    if (!claims.siteId) {
      return { valid: false, reason: 'Missing siteId claim' };
    }

    const configuredSiteId = auth.getSiteId();
    if (configuredSiteId && !BYPASS_SITE_IDS.includes(configuredSiteId) && claims.siteId !== configuredSiteId) {
      return {
        valid: false,
        reason: `Access denied for site ${claims.siteId}`,
      };
    }

    return { valid: true };
  }

  extractTokenFromRequest(req: { headers?: { authorization?: string } }): string | null {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  private sanitizeErrorMessage(error: unknown): string {
    if (error instanceof joseErrors.JWTExpired) return 'Token expired';
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) return 'Invalid token signature';
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      if (error.claim === 'aud') return 'Invalid token audience';
      if (error.claim === 'iss') return 'Invalid token issuer';
      if (error.claim === 'nbf') return 'Token not active yet';
      return 'JWT claim validation failed';
    }
    if (error instanceof joseErrors.JWKSNoMatchingKey) return 'Invalid token signature';
    if (error instanceof joseErrors.JWKSTimeout) return 'Failed to fetch public key: timeout';
    if (error instanceof joseErrors.JOSEError) return 'Invalid token format';
    return 'JWT validation failed';
  }

  getConfig() {
    return {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: this.config.algorithms,
      jwksUrl: this.config.jwksUrl,
    };
  }
}

let jwtValidatorInstance: JWTValidator | null = null;

export function getJWTValidator(): JWTValidator {
  if (!jwtValidatorInstance) {
    jwtValidatorInstance = new JWTValidator();
  }
  return jwtValidatorInstance;
}
