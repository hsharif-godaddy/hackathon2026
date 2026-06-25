/**
 * JWT Configuration
 * Centralized configuration for JWT authentication
 */

import type { AuthType, ProductType } from '@airo/shared/auth';

export interface JWTConfig {
  secretName: string;
  awsRegion: string;
}

export interface JWTClaims {
  // Standard JWT claims
  iss: string;      // Issuer - hardcoded to 'airo-app'
  aud: string;      // Audience - hardcoded to 'agents-service'
  exp: number;      // Expiration
  iat: number;      // Issued at

  // Custom claims
  siteId: string;          // Site ID
  customerId?: string;      // GoDaddy Customer ID (UUID)
  shopperId?: string;       // GoDaddy Shopper ID from JWT claim (typically numeric in production)
  visitorId?: string;      // From `visitor` cookie at mint
  trafficSessionId?: string; // From `pathway` cookie at mint → Signals sessionId
  canDownload: boolean;    // Permission to download app files
  canPublish: boolean;     // Permission to publish app
  canPurchaseDomain: boolean; // Permission to purchase and attach custom domains
  authType?: AuthType; // Authentication type: basic (normal), e2s (care/employee impersonation), s2s (shopper delegation)
  isE2S: boolean; // DEPRECATED: Use authType === 'e2s' instead. Only true for e2s (care), NOT s2s (delegation)
  useTestBudget?: boolean; // When true, bypass grants and use test-accounts budget (switchboard: appbuilder-test-budget)
  budgetServiceEnabled?: boolean; // When true, use Budget Service flow instead of legacy grants (switchboard: app-builder-budget-service)
  subscriptionId?: string; // Subscription ID for Budget Service API calls
  bmsBudgetId?: string; // BMS budget ID for direct Budget Service API calls (set when subscription.bmsBudgetId exists)
  enableAssessmentAgent?: boolean; // When true, enable assessment agent for prompt classification (switchboard: appbuilder-assessment-agent)
  enableAssessmentOverride?: boolean; // When true, apply budget override from assessment (switchboard: appbuilder-assessment-override). Requires enableAssessmentAgent.
  product?: ProductType; // Product type: 'AiroAppBuilder' (default) or 'PaaSNodeJS'
  modelOverride?: string; // When set, override the default agent model (switchboard: appbuilder-model-override)
  modelSelectorEnabled?: boolean; // When true, allow per-project model selection from frontend (switchboard: appbuilder-model-selector)
  agentProfile?: string; // When set, activate the named agent profile (switchboard: appbuilder-agent-profile)
  agentProfileSelectorEnabled?: boolean; // When true, allow per-project profile selection from frontend (switchboard: appbuilder-agent-profile-selector)
  costAttributionDryRun?: boolean; // When true, run cost attribution analysis and log results but skip BMS reconciliation (switchboard: appbuilder-cost-attribution-dry-run)
  isOwner?: boolean; // When hosting returned owner id: JWT customer is app owner (multi-user)
  useAtlasCrawler?: boolean; // When true, route rebuild scraping through the Atlas REST API instead of the external web-scraper API (switchboard: appbuilder-atlas-crawler)
  rebuildIntakeFormEnabled?: boolean; // When true, show initial-rebuild intake form before scraping (switchboard: appbuilder-rebuild-intake-form)
  rebuildSourceImagesEnabled?: boolean; // When true, register crawled source images into the Media tab during rebuild (switchboard: appbuilder-rebuild-source-images)
  debugStatsEnabled?: boolean; // When true, agents service emits per-LLM-call debug_turn_stats events to this client (switchboard: appbuilder-debug-drawer)
  market?: string; // User's resolved market locale (e.g. 'en-US', 'es-MX') from gasket visitor
  fqdn?: string; // Purchased domain carried in from the DPP handoff (SiteInfo.fqdn); readable by agent tools
  marketingCampaignsEnabled?: boolean; // When true, enable Marketing Campaigns feature (switchboard: appbuilder-marketing-campaigns)
  googleBusinessProfileSyncEnabled?: boolean; // When true, enable Google Business Profile sync skill (switchboard: appbuilder-google-business-profile-sync)
  asmDualWriteEnabled?: boolean; // When true, agents service mirrors SQLite conversation writes to ASM (switchboard: appbuilder-asm-dual-write)
  logoBrandColorsEnabled?: boolean; // When true, send structured brand colors to the logo API (switchboard: appbuilder-logo-brand-colors)
  purchaseIntentClassifierEnabled?: boolean; // When true, enable LLM purchase-intent classifier on credit=0 402 path (switchboard: appbuilder-purchase-intent-classifier)
  skillSuggestionsEnabled?: boolean; // When true, merge skill-reported pending capabilities into "Continue building" next-actions (switchboard: appbuilder-skill-suggestions)
  // Auth-at-Edge SSO defense-in-depth claims (Phase 1).
  // ssoRequired = the app's `apps.sso_required` flag from mhp-core (admin-controlled).
  // ssoConfigured = BFF's UX check that BOTH credential pointer rows
  //   (e.g. `GD_SSO_OAUTH_CLIENT_ID` / `GD_SSO_OAUTH_CLIENT_SECRET` —
  //   resolved per-config from `SiteInfo.clientIdSecretName` /
  //   `clientSecretSecretName`) are present in airo-go's customer-proxy
  //   auth-group GET. NOT a check on the `SSO_OAUTH_CONFIG` cache row
  //   itself, and NOT a mirror of mhp-core's authoritative publish gate
  //   (that lives at hosting + dev-supervisor at request time). Used by
  //   the agents/ requireSsoConfigured middleware to close the direct-
  //   agents-JWT publish-bypass surface without re-reading upstream state
  //   per request. Staleness bounded by token TTL; the LCP/mhp-core publish
  //   gate remains the canonical runtime authority.
  ssoRequired?: boolean;
  ssoConfigured?: boolean;
  // Raw `ownerProduct` from SiteInfo (e.g. 'aab-ent-v1', 'aab-v1',
  // 'paas-nodejs-v1'). Carried into the agent JWT so the agent can detect
  // enterprise-managed apps and suppress upgrade-plan copy in chat — those
  // apps have subscription/plan changes owned by the enterprise admin, not
  // the customer. Empty string when SiteInfo omitted it (non-V2 sites).
  ownerProduct?: string;
}

/**
 * Get JWT configuration from environment variables
 */
export function getJWTConfig(): JWTConfig {
  const secretName = process.env.JWT_SECRETS_NAME || 'dev-airo-jwt-keys';
  const awsRegion = process.env.AWS_REGION || 'us-west-2';

  return {
    secretName,
    awsRegion
  };
}

/**
 * Get hardcoded JWT constants
 */
export function getJWTConstants() {
  return {
    issuer: 'airo-app',
    audience: 'agents-service',
    algorithm: 'RS256' as const,
    expiresIn: '12h'
  };
}
