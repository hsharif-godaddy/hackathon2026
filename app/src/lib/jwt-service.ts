/**
 * JWT Service
 * Creates and manages JWT tokens using private keys from Secrets Manager
 *
 * @note This file is server-only and uses Node.js crypto module
 */

import { createSign } from 'node:crypto';

import type { AuthType, ProductType } from '@airo/shared/auth';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { getJWTConfig, getJWTConstants, JWTClaims } from './jwt-config';
import { logger } from './request-context';

export interface CreateTokenOptions {
  siteId: string;
  customerId?: string;
  shopperId?: string;
  visitorId?: string;
  trafficSessionId?: string;
  canDownload: boolean;
  canPublish: boolean;
  canPurchaseDomain?: boolean;
  authType?: AuthType;
  isE2S: boolean; // Backward compatibility
  useTestBudget?: boolean; // Bypass grants and use test-accounts budget
  budgetServiceEnabled?: boolean; // Use Budget Service flow instead of legacy grants
  subscriptionId?: string; // Subscription ID for Budget Service API calls
  bmsBudgetId?: string; // BMS budget ID for direct Budget Service API calls
  enableAssessmentAgent?: boolean; // Enable assessment agent for prompt classification
  enableAssessmentOverride?: boolean; // Apply budget override from assessment (requires enableAssessmentAgent)
  assessmentClassifier?: string; // Which classifier to use (switchboard: appbuilder-assessment-classifier)
  product?: ProductType; // Product type: 'AiroAppBuilder' (default) or 'PaaSNodeJS'
  modelOverride?: string; // Override the default agent model (switchboard: appbuilder-model-override)
  modelSelectorEnabled?: boolean; // Allow per-project model selection from frontend (switchboard: appbuilder-model-selector)
  agentProfile?: string; // Activate the named agent profile (switchboard: appbuilder-agent-profile)
  agentProfileSelectorEnabled?: boolean; // Allow per-project profile selection from frontend (switchboard: appbuilder-agent-profile-selector)
  costAttributionDryRun?: boolean; // Log cost attribution results but skip BMS reconciliation (switchboard: appbuilder-cost-attribution-dry-run)
  useAtlasCrawler?: boolean; // Route rebuild scraping through the Atlas REST API instead of the external web-scraper API (switchboard: appbuilder-atlas-crawler)
  rebuildIntakeFormEnabled?: boolean; // Show initial-rebuild intake form before scraping (switchboard: appbuilder-rebuild-intake-form)
  rebuildSourceImagesEnabled?: boolean; // Register crawled source images into the Media tab during rebuild (switchboard: appbuilder-rebuild-source-images)
  debugStatsEnabled?: boolean; // Agents service should emit per-LLM-call debug_turn_stats events to this client (switchboard: appbuilder-debug-drawer)
  isOwner?: boolean; // App owner vs collaborator when owner id is known from hosting
  market?: string; // User's resolved market locale (e.g. 'en-US', 'es-MX')
  fqdn?: string; // Purchased domain carried in from the DPP handoff (SiteInfo.fqdn); readable by agent tools
  marketingCampaignsEnabled?: boolean; // Enable Marketing Campaigns feature (switchboard: appbuilder-marketing-campaigns)
  googleBusinessProfileSyncEnabled?: boolean; // Enable Google Business Profile sync skill (switchboard: appbuilder-google-business-profile-sync)
  asmDualWriteEnabled?: boolean; // Mirror SQLite conversation writes to ASM (switchboard: appbuilder-asm-dual-write)
  logoBrandColorsEnabled?: boolean; // Send structured brand colors to the logo API (switchboard: appbuilder-logo-brand-colors)
  purchaseIntentClassifierEnabled?: boolean; // Enable LLM purchase-intent classifier on credit=0 402 path (switchboard: appbuilder-purchase-intent-classifier)
  skillSuggestionsEnabled?: boolean; // Merge skill-reported pending capabilities into "Continue building" next-actions (switchboard: appbuilder-skill-suggestions)
  ssoRequired?: boolean; // Auth-at-Edge: app's apps.sso_required flag (admin-controlled in mhp-core)
  // BFF UX gate: both credential pointer rows present in airo-go's customer-proxy auth group
  // (names resolved per-config from SiteInfo.clientIdSecretName/clientSecretSecretName, mhp-core PR #738).
  // NOT a check on the SSO_OAUTH_CONFIG cache row; NOT the canonical publish gate (that lives
  // at hosting + dev-supervisor at request time). See app/src/lib/jwt-config.ts for the full contract.
  ssoConfigured?: boolean;
  // Raw `ownerProduct` from SiteInfo. The agent uses this to decide whether
  // upgrade-plan suggestions are actionable: enterprise-managed apps
  // (`ownerProduct === 'aab-ent-v1'`) have plan changes owned by the
  // enterprise admin, not the customer chatting with the agent. When set
  // to the ent value, the agent must replace "upgrade your plan" copy
  // with "contact your enterprise admin" guidance. See
  // `agents/src/server/middleware/jwt-auth.ts` for the agent-side mirror.
  ownerProduct?: string;
}

export interface TokenResult {
  token: string;
  expires: Date;
}

interface KeyMetadata {
  keyId: string;
  privateKey: string;
  publicKey: string;
  status: 'active' | 'rotating';
  createdAt: string;
  expiresAt: string;
}

interface JWTSecretValue {
  keys: KeyMetadata[];
  lastRotation: string;
  nextRotation: string;
}

/**
 * JWT Service - handles token creation using private keys
 */
export class JWTService {
  private config = getJWTConfig();
  private constants = getJWTConstants();
  private secretsClient: SecretsManagerClient;
  private tokenCache = new Map<string, { token: string; expires: Date }>();
  private keyCache: { keys: KeyMetadata[]; cachedAt: Date } | null = null;
  private readonly keyCacheMaxAge = 5 * 60 * 1000;
  private fetchKeysPromise: Promise<KeyMetadata[]> | null = null;

  constructor() {
    this.secretsClient = new SecretsManagerClient({ region: this.config.awsRegion });
  }

  /**
   * Fetch all keys from Secrets Manager with caching and request deduplication
   */
  private async fetchKeys(): Promise<KeyMetadata[]> {
    // Return cached keys if still valid
    if (this.keyCache && (Date.now() - this.keyCache.cachedAt.getTime()) < this.keyCacheMaxAge) {
      return this.keyCache.keys;
    }

    // Deduplicate concurrent requests - if fetch is in progress, wait for it
    if (this.fetchKeysPromise) {
      return this.fetchKeysPromise;
    }

    // Start new fetch
    this.fetchKeysPromise = this.fetchKeysFromAWS();

    try {
      const keys = await this.fetchKeysPromise;
      return keys;
    } finally {
      this.fetchKeysPromise = null;
    }
  }

  /**
   * Internal method to fetch keys from AWS Secrets Manager
   */
  private async fetchKeysFromAWS(): Promise<KeyMetadata[]> {
    try {
      const command = new GetSecretValueCommand({
        SecretId: this.config.secretName
      });

      const response = await this.secretsClient.send(command);

      if (!response.SecretString) {
        throw new Error('No secret value found');
      }

      const secretValue: JWTSecretValue = JSON.parse(response.SecretString);

      // Update cache
      this.keyCache = {
        keys: secretValue.keys,
        cachedAt: new Date()
      };

      return secretValue.keys;

    } catch (error) {
      logger.error('jwt.keys.fetch.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        secretName: this.config.secretName
      });
      throw new Error(`Failed to fetch keys: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current active signing key from Secrets Manager
   */
  private async getActiveKey(): Promise<KeyMetadata> {
    const keys = await this.fetchKeys();

    const activeKey = keys.find(key => key.status === 'active');

    if (!activeKey) {
      throw new Error('No active signing key found');
    }

    logger.debug('jwt.key.retrieved', {
      keyId: activeKey.keyId,
      status: activeKey.status
    });

    return activeKey;
  }

  /**
   * Create JWT header and payload
   *
   * @param options - Token creation options
   * @param keyId - Key ID for JWT header
   * @param expiresInSeconds - Token expiration time in seconds (default: 12 hours)
   * @returns JWT header and payload as base64url strings
   */
  private createTokenPayload(options: CreateTokenOptions, keyId: string, expiresInSeconds?: number): { header: string; payload: string } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (expiresInSeconds || (12 * 60 * 60));

    const header = {
      typ: 'JWT',
      alg: this.constants.algorithm,
      kid: keyId
    };

    const claims: JWTClaims = {
      iss: this.constants.issuer,
      aud: this.constants.audience,
      exp,
      iat: now,
      siteId: options.siteId,
      customerId: options.customerId,
      ...(options.shopperId && { shopperId: options.shopperId }),
      visitorId: options.visitorId,
      trafficSessionId: options.trafficSessionId,
      canDownload: options.canDownload,
      canPublish: options.canPublish,
      canPurchaseDomain: options.canPurchaseDomain ?? false,
      authType: options.authType || 'basic',
      isE2S: options.isE2S,
      useTestBudget: options.useTestBudget ?? false,
      budgetServiceEnabled: options.budgetServiceEnabled ?? false,
      subscriptionId: options.subscriptionId,
      bmsBudgetId: options.bmsBudgetId,
      enableAssessmentAgent: options.enableAssessmentAgent ?? false,
      enableAssessmentOverride: options.enableAssessmentOverride ?? false,
      ...(options.assessmentClassifier && { assessmentClassifier: options.assessmentClassifier }),
      product: options.product || 'AiroAppBuilder',
      ...(options.modelOverride && { modelOverride: options.modelOverride }),
      modelSelectorEnabled: options.modelSelectorEnabled ?? false,
      ...(options.agentProfile && { agentProfile: options.agentProfile }),
      agentProfileSelectorEnabled: options.agentProfileSelectorEnabled ?? false,
      costAttributionDryRun: options.costAttributionDryRun ?? false,
      ...(options.isOwner !== undefined && { isOwner: options.isOwner }),
      useAtlasCrawler: options.useAtlasCrawler ?? false,
      rebuildIntakeFormEnabled: options.rebuildIntakeFormEnabled ?? false,
      rebuildSourceImagesEnabled: options.rebuildSourceImagesEnabled ?? false,
      debugStatsEnabled: options.debugStatsEnabled ?? false,
      ...(options.market && { market: options.market }),
      ...(options.fqdn && { fqdn: options.fqdn }),
      marketingCampaignsEnabled: options.marketingCampaignsEnabled ?? false,
      googleBusinessProfileSyncEnabled: options.googleBusinessProfileSyncEnabled ?? false,
      asmDualWriteEnabled: options.asmDualWriteEnabled ?? false,
      logoBrandColorsEnabled: options.logoBrandColorsEnabled ?? false,
      purchaseIntentClassifierEnabled: options.purchaseIntentClassifierEnabled ?? false,
      skillSuggestionsEnabled: options.skillSuggestionsEnabled ?? false,
      ssoRequired: options.ssoRequired ?? false,
      ssoConfigured: options.ssoConfigured ?? false,
      // Empty string when unknown (non-V2 site, or upstream omitted it).
      // Agent reads the literal "aab-ent-v1" sentinel to suppress upgrade-
      // plan copy in chat.
      ownerProduct: options.ownerProduct ?? '',
    };

    const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify(claims)).toString('base64url');

    return {
      header: headerBase64,
      payload: payloadBase64
    };
  }

  /**
   * Create JWT token using Node.js crypto for signing
   *
   * @param options - Token creation options
   * @param expiresInSeconds - Token expiration time in seconds (default: 12 hours)
   * @returns Token and expiration date
   */
  async createToken(options: CreateTokenOptions, expiresInSeconds?: number): Promise<TokenResult> {
    try {
      const activeKey = await this.getActiveKey();

      const { header, payload } = this.createTokenPayload(options, activeKey.keyId, expiresInSeconds);

      const message = `${header}.${payload}`;

      const sign = createSign('RSA-SHA256');
      sign.update(message);
      sign.end();

      const signature = sign.sign(activeKey.privateKey, 'base64url');

      const token = `${message}.${signature}`;

      const exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')).exp;
      const expires = new Date(exp * 1000);

      logger.info('jwt.token.created', {
        siteId: options.siteId,
        keyId: activeKey.keyId,
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
   * Cache key omits visitorId/trafficSessionId: observability-only, rotate often, and would unbound tokenCache if keyed.
   * createTokenPayload still sets them from options on each mint. Other fields bound cache size as before.
   */
  private getCacheKey(options: CreateTokenOptions): string {
    const authType = options.authType || 'basic';
    return `${options.siteId}:${options.customerId || ''}:${options.canDownload}:${options.canPublish}:${options.canPurchaseDomain ?? false}:${authType}:${options.useTestBudget ?? false}:${options.budgetServiceEnabled ?? false}:${options.subscriptionId || ''}:${options.enableAssessmentAgent ?? false}:${options.enableAssessmentOverride ?? false}:${options.assessmentClassifier || ''}:${options.product || 'AiroAppBuilder'}:${options.modelOverride || ''}:${options.modelSelectorEnabled ?? false}:${options.agentProfile || ''}:${options.agentProfileSelectorEnabled ?? false}:${options.costAttributionDryRun ?? false}:${options.bmsBudgetId || ''}:${options.useAtlasCrawler ?? false}:${options.rebuildIntakeFormEnabled ?? false}:${options.rebuildSourceImagesEnabled ?? false}:${options.debugStatsEnabled ?? false}:${options.market || ''}:${options.fqdn || ''}:${options.marketingCampaignsEnabled ?? false}:${options.googleBusinessProfileSyncEnabled ?? false}:${options.asmDualWriteEnabled ?? false}:${options.logoBrandColorsEnabled ?? false}:${options.purchaseIntentClassifierEnabled ?? false}:${options.skillSuggestionsEnabled ?? false}:${options.ssoRequired ?? false}:${options.ssoConfigured ?? false}:${options.ownerProduct ?? ''}`;
  }

  /**
   * Get cached token or create new one
   */
  async getToken(options: CreateTokenOptions): Promise<TokenResult> {
    const cacheKey = this.getCacheKey(options);
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expires > new Date(Date.now() + 60000)) {
      return cached;
    }

    const result = await this.createToken(options);
    this.tokenCache.set(cacheKey, result);

    return result;
  }

  /**
   * Refresh token
   */
  async refreshToken(options: CreateTokenOptions): Promise<TokenResult> {
    const result = await this.createToken(options);
    const cacheKey = this.getCacheKey(options);
    this.tokenCache.set(cacheKey, result);
    return result;
  }

  /**
   * Pre-fetch keys so the JWKS endpoint responds instantly on first hit.
   */
  async warmKeys(): Promise<void> {
    await this.fetchKeys();
  }

  /**
   * Get all public keys for JWKS endpoint
   */
  async getPublicKeys(): Promise<KeyMetadata[]> {
    return this.fetchKeys();
  }
}

let jwtServiceInstance: JWTService | null = null;

export function getJWTService(): JWTService {
  if (!jwtServiceInstance) {
    jwtServiceInstance = new JWTService();
  }
  return jwtServiceInstance;
}
