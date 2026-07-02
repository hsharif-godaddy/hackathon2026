/**
 * Agent Token Endpoint
 * Creates JWT tokens for agent communication with configurable TTL
 * POST /api/auth/agent-token
 *
 * @param request.body.siteId - Site ID for the token
 * @param request.body.expiresInSeconds - Optional expiration time in seconds (must be > 0 and <= 43200, default: 12 hours)
 * @param request.body.owningProduct - Optional owner product to filter by (defaults to AiroAppBuilder)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isEmployeeAuthType, type ProductType } from '@airo/shared/auth';

import { EXPERIMENT_IDS, INITIAL_AGENT_COHORT_TO_PROFILE } from '@/config/experiments';
import { setApmAppId, setApmCustomerId } from '@/lib/apm-context';
import { getAuthzFgaConfig } from '@/lib/authz-fga/config';
import { enforceAabMultiUserCanBuild } from '@/lib/authz-fga/enforce-can-build';
import { ensureAppTeamVenture } from '@/lib/authz-fga/ensure-app-venture';
import { listObjects as fgaListObjects } from '@/lib/authz-fga/list-objects';
import { getAuthzFgaAccessToken } from '@/lib/authz-fga/oauth-token';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { checkBmsMigration, getMigrationDate, shouldCheckBmsMigration } from '@/lib/bms-migration';
import {
  fetchHivemindCohorts,
  normalizeHivemindCohort,
} from '@/lib/budget-service-experiment';
import { resolveCareAgentIdentity } from '@/lib/care-agent-identity';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import type { SiteInfo } from '@/lib/control-plane/types';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, type CustomerUser, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { resolveMarketId } from '@/lib/market/resolve-market';
import { AIRO_OWNER_PRODUCTS, AiroMgmtClient } from '@/lib/mgmt-airo';
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core';
import { ServerPaywallProvider } from '@/lib/paywall/server-provider';
import { isPaidPlanForGrants, PaywallDenialReason } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { resolveSsoPointerNames } from '@/lib/sso/pointer-names';
import { checkSwitchboardFlag, checkSwitchboardValue } from '@/lib/switchboard/server';
import { extractDelegatedEmployee } from '@/lib/utils/jwt-utils';
import { getPlanFromSubscription } from '@/utils/credits';
import { trafficPathwaySessionId } from '@/utils/traffic-signals';
import { visitorIdFromVisitorCookieRaw } from '@/utils/visitor-id';
import { getSiteValidationFromCache, setSiteValidationCache } from './site-validation-cache';

export interface CreateAgentTokenRequest {
  siteId: string;
  expiresInSeconds?: number;
  owningProduct?: ProductType;
}

export const dynamic = 'force-dynamic';

/**
 * Maximum allowed expiration time in seconds (12 hours)
 */
const MAX_EXPIRATION_SECONDS = 12 * 60 * 60; // 43200 seconds

/**
 * Validate site existence using control plane adapter (lightweight)
 * Uses appExists() instead of getSite() to avoid expensive getApp() API call
 */
async function validateSiteAccess(siteId: string, user: CustomerUser, jwt: string, owningProduct?: string, multiUserEnabled?: boolean): Promise<NextResponse | null> {
  if (!customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to create agent tokens', 403);
  }

  const adapter = getControlPlaneAdapter();
  const productFilter = owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;

  let exists: boolean;
  try {
    exists = await adapter.appExists(siteId, jwt, productFilter, multiUserEnabled);
  } catch (error) {
    logger.error('agent-token.control-plane.app-exists-failed', {
      siteId,
      customerId: user.customerId,
      action: PaywallAction.Publish,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
    throw error;
  }

  if (!exists) {
    logger.warn('agent-token.control-plane.site-not-found', {
      siteId,
      customerId: user.customerId,
      action: PaywallAction.Publish,
    });
    return NextResponse.json({
      error: 'Site not found'
    }, { status: 404 });
  }

  return null;
}

/**
 * Extract paywall permissions from a settled promise result (fail closed)
 */
function resolvePaywallResult(
  result: PromiseSettledResult<Awaited<ReturnType<typeof checkPaywallEligibility>>>,
  siteId: string,
  customerId: string,
  action: PaywallAction
): { canDownload: boolean; canPublish: boolean } {
  if (result.status === 'rejected') {
    logger.error('agent-token.paywall-check.rejected', {
      siteId,
      customerId,
      action,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      errorType: result.reason instanceof Error ? result.reason.constructor.name : typeof result.reason,
    });
    return { canDownload: false, canPublish: false };
  }

  const eligibility = result.value;
  const canPublish = eligibility.hasAccess;
  const canDownload = eligibility.hasAccess || (
    eligibility.reason === PaywallDenialReason.PublishLimitReached &&
    eligibility.details.hasSubscription
  );

  const eligibilityDetails = {
    hasAccess: eligibility.hasAccess,
    reason: eligibility.reason,
    hasSubscription: eligibility.details.hasSubscription,
    hasEntitlements: eligibility.details.hasEntitlements,
    hasMatchingProject: eligibility.details.hasMatchingProject,
    publishLimit: eligibility.details.publishLimit,
    publishedCount: eligibility.details.publishedCount,
    subscriptionId: eligibility.details.subscriptionId,
  };

  if (canPublish || canDownload) {
    logger.info('agent-token.paywall-check.success', {
      siteId,
      customerId,
      action,
      canPublish,
      canDownload,
      environment: process.env.NODE_ENV,
      ...eligibilityDetails,
    });
  } else {
    logger.warn('agent-token.paywall-check.denied', {
      siteId,
      customerId,
      action,
      ...eligibilityDetails,
    });
  }

  return { canDownload, canPublish };
}

/**
 * Extract boolean switchboard flag from a settled promise result (fail closed)
 *
 * @param result - Promise result from checkSwitchboardFlag
 * @param logEvent - Log event name for failures (e.g., 'agent-token.domain-purchase-flag-check-failed')
 * @param siteId - Site ID for logging
 * @param customerId - Customer ID for logging
 * @returns Flag value, or false on rejection (fail closed)
 */
function resolveSubscriptionId(
  result: PromiseSettledResult<{ subscription_id?: string }>,
  siteId: string,
  customerId: string,
): string | undefined {
  if (result.status === 'rejected') {
    logger.warn('agent-token.subscription-lookup-failed', {
      siteId,
      customerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return undefined;
  }
  return result.value?.subscription_id;
}

/**
 * Owner-pays gate for shared-app collaborators.
 *
 * A collaborator on a shared app operates under the OWNER's subscription, so
 * publish/download must be gated on the OWNER's plan — not the collaborator's
 * plan and not the FGA relation alone. Without this, a FREE owner's app could be
 * published/downloaded by any collaborator holding the relation, bypassing the
 * paywall entirely.
 *
 * Gate = the owner is on a grants-paid plan (Starter/Professional/Ultimate),
 * read from the app's subscription (`subscriptionId`) with the caller's JWT —
 * the same path the BMS block and shared getSite already use.
 *
 * We deliberately do NOT enforce the owner's published-app COUNT limit here.
 * That limit depends on the owner's account-best plan and full app inventory,
 * which can't be reconstructed reliably from a collaborator's JWT against a
 * single subscription (e.g. an Ultimate owner with 27/50 published read as a
 * lower tier → wrongly blocked). The owner's own publishes are still
 * count-limited via the normal owner paywall; this matches the download gate
 * (which is also plan-only), and mhp-core does not enforce the count regardless.
 *
 * Fails closed (throws) on any error; callers must treat a throw as "deny".
 */
async function resolveOwnerPaywall(args: {
  subscriptionId: string;
  jwt: string;
}): Promise<{ ownerAllowsPublish: boolean; ownerAllowsDownload: boolean }> {
  const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
  const client = new AiroMgmtClient({ baseUrl, jwt: args.jwt });

  const ownerSubscription = await client.getSubscription(args.subscriptionId, { includeAttributes: true });
  const ownerIsPaid = isPaidPlanForGrants(getPlanFromSubscription(ownerSubscription));

  return { ownerAllowsPublish: ownerIsPaid, ownerAllowsDownload: ownerIsPaid };
}

function resolveFqdn(
  result: PromiseSettledResult<{ fqdn?: string }>,
  siteId: string,
  customerId: string,
): string | undefined {
  if (result.status === 'rejected') {
    logger.warn('agent-token.fqdn-lookup-failed', {
      siteId,
      customerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return undefined;
  }
  return result.value?.fqdn;
}

function resolveBooleanFlag(
  result: PromiseSettledResult<boolean>,
  logEvent: string,
  siteId: string,
  customerId: string
): boolean {
  if (result.status === 'rejected') {
    logger.warn(logEvent, {
      siteId,
      customerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return false;
  }
  return result.value;
}

function resolveStringFlag(
  result: PromiseSettledResult<string | null>,
  logEvent: string,
  siteId: string,
  customerId: string
): string | null {
  if (result.status === 'rejected') {
    logger.warn(logEvent, {
      siteId,
      customerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return null;
  }
  return result.value;
}

function resolveSiteInfoFromGetSite(
  result: PromiseSettledResult<SiteInfo | null>,
  siteId: string,
  customerId: string,
): SiteInfo | null {
  if (result.status === 'rejected') {
    logger.warn('agent-token.get-site-info-failed', {
      siteId,
      customerId,
      action: PaywallAction.Publish,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return null;
  }
  return result.value;
}

export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext): Promise<NextResponse> => {
  const routeStart = Date.now();
  const timing: Record<string, number> = {};

  try {
    const bodyParseStart = Date.now();
    const body: CreateAgentTokenRequest = await request.json();
    timing.bodyParseMs = Date.now() - bodyParseStart;
    const { user } = authContext;

    if (!body.siteId) {
      return NextResponse.json({
        error: 'siteId is required'
      }, { status: 400 });
    }

    if (body.expiresInSeconds !== undefined) {
      if (body.expiresInSeconds <= 0) {
        return NextResponse.json({
          error: 'expiresInSeconds must be greater than 0'
        }, { status: 400 });
      }

      if (body.expiresInSeconds > MAX_EXPIRATION_SECONDS) {
        return NextResponse.json({
          error: `expiresInSeconds cannot exceed ${MAX_EXPIRATION_SECONDS} seconds (12 hours)`
        }, { status: 400 });
      }
    }

    // Validate owningProduct against known values
    if (body.owningProduct !== undefined) {
      const validOwningProducts = Object.values(AIRO_OWNER_PRODUCTS) as string[];
      const trimmed = typeof body.owningProduct === 'string' ? body.owningProduct.trim() : '';
      if (!trimmed || !validOwningProducts.includes(trimmed)) {
        return NextResponse.json({
          error: `Invalid owningProduct. Allowed values: ${validOwningProducts.join(', ')}`
        }, { status: 400 });
      }
      body.owningProduct = trimmed as ProductType;
    }

    const adapter = getControlPlaneAdapter();
    const siteAccessStart = Date.now();
    const siteValidationCacheHit = getSiteValidationFromCache(user.customerId, body.siteId, body.owningProduct);

    // When site-validation-cache misses, run site validation, paywall, and switchboard in parallel
    // When cache hits, skip site validation but still need paywall + switchboard
    let validationError: NextResponse | null = null;
    let canDownload = false;
    let canPublish = false;
    let canPurchaseDomain = false;
    let useTestBudget = false;
    let budgetServiceEnabled = false;
    let bmsExistingEnabled = false;
    let subscriptionId: string | undefined;
    let fqdn: string | undefined;
    let enableAssessmentAgent = false;
    let enableAssessmentOverride = false;
    let enableFixSession = false;
    let assessmentClassifier: string | undefined;
    let modelSelectorEnabled = false;
    let modelOverride: string | undefined;
    let agentProfileSelectorEnabled = false;
    let agentProfile: string | undefined;
    let costAttributionDryRun = false;
    let siteInfo: SiteInfo | null = null;
    let useAtlasCrawler = false;
    let rebuildIntakeFormEnabled = false;
    let debugStatsEnabled = false;
    let marketingCampaignsEnabled = false;
    let googleBusinessProfileSyncEnabled = false;
    let asmDualWriteEnabled = false;
    let logoBrandColorsEnabled = false;
    let purchaseIntentClassifierEnabled = false;
    let skillSuggestionsEnabled = false;
    let rebuildSourceImagesEnabled = false;

    const { visitorMarket: market } = await resolveMarketId(request);

    // Resolve aab-multi-user once so getSite/appExists skip all shared-app
    // discovery (the shared-apps listing) when the feature is off. Fast
    // in-memory cache lookup; treat a Switchboard outage as off.
    let multiUserEnabled = false;
    try {
      multiUserEnabled = await checkSwitchboardFlag('aab-multi-user', request);
    } catch (err) {
      logger.warn('aab-multi-user.flag.lookupError', {
        siteId: body.siteId,
        error: err instanceof Error ? err.message : 'Unknown switchboard error',
      });
    }

    if (siteValidationCacheHit) {
      // Cache hit: skip site validation, run paywall + switchboard + subscription lookup in parallel
      logger.info('agent-token.paywall-check.start', {
        appId: body.siteId,
        customerId: user.customerId,
        action: PaywallAction.Publish,
        cacheHit: true,
      });
      setApmAppId(body.siteId);
      setApmCustomerId(user.customerId);
      const parallelStart = Date.now();
      const [paywallResult, domainPurchaseResult, testBudgetResult, budgetServiceResult, bmsExistingResult, siteInfoResult, assessmentAgentResult, assessmentOverrideResult, assessmentClassifierResult, modelSelectorResult, modelOverrideResult, agentProfileSelectorResult, agentProfileResult, costAttributionDryRunResult, useAtlasCrawlerResult, rebuildIntakeFormResult, debugDrawerResult, marketingCampaignsResult, googleBusinessProfileSyncResult, asmDualWriteResult, logoBrandColorsResult, purchaseIntentClassifierResult, skillSuggestionsResult, rebuildSourceImagesResult, fixSessionResult] = await Promise.allSettled([
        checkPaywallEligibility(
          new ServerPaywallProvider(authContext.jwt || '', user.customerId, request.headers),
          body.siteId,
          PaywallAction.Publish
        ),
        checkSwitchboardFlag('appbuilder-domain-purchase', request),
        checkSwitchboardFlag('appbuilder-test-budget', request),
        checkSwitchboardFlag('app-builder-budget-service', request),
        checkSwitchboardFlag('app-builder-bms-existing', request),
        adapter.getSite(body.siteId, authContext.jwt || '', body.owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER, { multiUserEnabled }),
        checkSwitchboardFlag('appbuilder-assessment-agent', request),
        checkSwitchboardFlag('appbuilder-assessment-override', request),
        checkSwitchboardValue('appbuilder-assessment-classifier', request),
        checkSwitchboardFlag('appbuilder-model-selector', request),
        checkSwitchboardValue('appbuilder-model-override', request),
        checkSwitchboardFlag('appbuilder-agent-profile-selector', request),
        checkSwitchboardValue('appbuilder-agent-profile', request),
        checkSwitchboardFlag('appbuilder-cost-attribution-dry-run', request),
        checkSwitchboardFlag('appbuilder-atlas-crawler', request),
        checkSwitchboardFlag('appbuilder-rebuild-intake-form', request),
        checkSwitchboardFlag('appbuilder-debug-drawer', request),
        checkSwitchboardFlag('appbuilder-marketing-campaigns', request),
        checkSwitchboardFlag('appbuilder-google-business-profile-sync', request),
        checkSwitchboardFlag('appbuilder-asm-dual-write', request),
        checkSwitchboardFlag('appbuilder-logo-brand-colors', request),
        checkSwitchboardFlag('appbuilder-purchase-intent-classifier', request),
        checkSwitchboardFlag('appbuilder-skill-suggestions', request),
        checkSwitchboardFlag('appbuilder-rebuild-source-images', request),
        checkSwitchboardFlag('appbuilder-fix-session', request),
      ]);
      timing.parallelChecksMs = Date.now() - parallelStart;

      ({ canDownload, canPublish } = resolvePaywallResult(paywallResult, body.siteId, user.customerId, PaywallAction.Publish));
      logger.info('agent-token.control-plane.check-passed', {
        siteId: body.siteId,
        customerId: user.customerId,
        action: PaywallAction.Publish,
        cacheHit: true,
        durationMs: Date.now() - routeStart,
      });
      canPurchaseDomain = resolveBooleanFlag(domainPurchaseResult, 'agent-token.domain-purchase-flag-check-failed', body.siteId, user.customerId);
      useTestBudget = resolveBooleanFlag(testBudgetResult, 'agent-token.test-budget-flag-check-failed', body.siteId, user.customerId);
      budgetServiceEnabled = resolveBooleanFlag(budgetServiceResult, 'agent-token.budget-service-flag-check-failed', body.siteId, user.customerId);
      bmsExistingEnabled = resolveBooleanFlag(bmsExistingResult, 'agent-token.bms-existing-flag-check-failed', body.siteId, user.customerId);
      subscriptionId = resolveSubscriptionId(siteInfoResult, body.siteId, user.customerId);
      fqdn = resolveFqdn(siteInfoResult, body.siteId, user.customerId);
      enableAssessmentAgent = resolveBooleanFlag(assessmentAgentResult, 'agent-token.assessment-agent-flag-check-failed', body.siteId, user.customerId);
      enableAssessmentOverride = resolveBooleanFlag(assessmentOverrideResult, 'agent-token.assessment-override-flag-check-failed', body.siteId, user.customerId);
      const rawAssessmentClassifier = resolveStringFlag(assessmentClassifierResult, 'agent-token.assessment-classifier-flag-check-failed', body.siteId, user.customerId);
      assessmentClassifier = rawAssessmentClassifier || undefined;
      modelSelectorEnabled = resolveBooleanFlag(modelSelectorResult, 'agent-token.model-selector-flag-check-failed', body.siteId, user.customerId);
      const rawModelOverride = resolveStringFlag(modelOverrideResult, 'agent-token.model-override-flag-check-failed', body.siteId, user.customerId);
      modelOverride = rawModelOverride && rawModelOverride !== 'default' ? rawModelOverride : undefined;
      agentProfileSelectorEnabled = resolveBooleanFlag(agentProfileSelectorResult, 'agent-token.agent-profile-selector-flag-check-failed', body.siteId, user.customerId);
      const rawAgentProfile = resolveStringFlag(agentProfileResult, 'agent-token.agent-profile-flag-check-failed', body.siteId, user.customerId);
      // Sentinels 'default' and 'hivemind' both mean "no operator override — let the
      // initial-agent Hivemind experiment decide". Any other value is an explicit
      // operator override (deployed default OR a targeted internal-account override)
      // and wins over the experiment.
      agentProfile = rawAgentProfile && rawAgentProfile !== 'default' && rawAgentProfile !== 'hivemind' ? rawAgentProfile : undefined;
      costAttributionDryRun = resolveBooleanFlag(costAttributionDryRunResult, 'agent-token.cost-attribution-dry-run-flag-check-failed', body.siteId, user.customerId);
      siteInfo = resolveSiteInfoFromGetSite(siteInfoResult, body.siteId, user.customerId);
      useAtlasCrawler = resolveBooleanFlag(useAtlasCrawlerResult, 'agent-token.atlas-crawler-flag-check-failed', body.siteId, user.customerId);
      rebuildIntakeFormEnabled = resolveBooleanFlag(rebuildIntakeFormResult, 'agent-token.rebuild-intake-form-flag-check-failed', body.siteId, user.customerId);
      debugStatsEnabled = resolveBooleanFlag(debugDrawerResult, 'agent-token.debug-drawer-flag-check-failed', body.siteId, user.customerId);
      marketingCampaignsEnabled = resolveBooleanFlag(marketingCampaignsResult, 'agent-token.marketing-campaigns-flag-check-failed', body.siteId, user.customerId);
      googleBusinessProfileSyncEnabled = resolveBooleanFlag(googleBusinessProfileSyncResult, 'agent-token.google-business-profile-sync-flag-check-failed', body.siteId, user.customerId);
      asmDualWriteEnabled = resolveBooleanFlag(asmDualWriteResult, 'agent-token.asm-dual-write-flag-check-failed', body.siteId, user.customerId);
      logoBrandColorsEnabled = resolveBooleanFlag(logoBrandColorsResult, 'agent-token.logo-brand-colors-flag-check-failed', body.siteId, user.customerId);
      purchaseIntentClassifierEnabled = resolveBooleanFlag(purchaseIntentClassifierResult, 'agent-token.purchase-intent-classifier-flag-check-failed', body.siteId, user.customerId);
      skillSuggestionsEnabled = resolveBooleanFlag(skillSuggestionsResult, 'agent-token.skill-suggestions-flag-check-failed', body.siteId, user.customerId);
      rebuildSourceImagesEnabled = resolveBooleanFlag(rebuildSourceImagesResult, 'agent-token.rebuild-source-images-flag-check-failed', body.siteId, user.customerId);
      enableFixSession = resolveBooleanFlag(fixSessionResult, 'agent-token.fix-session-flag-check-failed', body.siteId, user.customerId);
    } else {
      // Cache miss: run site validation, paywall, switchboard, and subscription lookup all in parallel
      logger.info('agent-token.paywall-check.start', {
        appId: body.siteId,
        customerId: user.customerId,
        action: PaywallAction.Publish,
        cacheHit: false,
      });
      setApmAppId(body.siteId);
      setApmCustomerId(user.customerId);
      const parallelStart = Date.now();
      const [siteResult, paywallResult, domainPurchaseResult, testBudgetResult, budgetServiceResult, bmsExistingResult, siteInfoResult, assessmentAgentResult, assessmentOverrideResult, assessmentClassifierResult, modelSelectorResult, modelOverrideResult, agentProfileSelectorResult, agentProfileResult, costAttributionDryRunResult, useAtlasCrawlerResult, rebuildIntakeFormResult, debugDrawerResult, marketingCampaignsResult, googleBusinessProfileSyncResult, asmDualWriteResult, logoBrandColorsResult, purchaseIntentClassifierResult, skillSuggestionsResult, rebuildSourceImagesResult, fixSessionResult] = await Promise.allSettled([
        validateSiteAccess(body.siteId, user, authContext.jwt || '', body.owningProduct, multiUserEnabled),
        checkPaywallEligibility(
          new ServerPaywallProvider(authContext.jwt || '', user.customerId, request.headers),
          body.siteId,
          PaywallAction.Publish
        ),
        checkSwitchboardFlag('appbuilder-domain-purchase', request),
        checkSwitchboardFlag('appbuilder-test-budget', request),
        checkSwitchboardFlag('app-builder-budget-service', request),
        checkSwitchboardFlag('app-builder-bms-existing', request),
        adapter.getSite(body.siteId, authContext.jwt || '', body.owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER, { multiUserEnabled }),
        checkSwitchboardFlag('appbuilder-assessment-agent', request),
        checkSwitchboardFlag('appbuilder-assessment-override', request),
        checkSwitchboardValue('appbuilder-assessment-classifier', request),
        checkSwitchboardFlag('appbuilder-model-selector', request),
        checkSwitchboardValue('appbuilder-model-override', request),
        checkSwitchboardFlag('appbuilder-agent-profile-selector', request),
        checkSwitchboardValue('appbuilder-agent-profile', request),
        checkSwitchboardFlag('appbuilder-cost-attribution-dry-run', request),
        checkSwitchboardFlag('appbuilder-atlas-crawler', request),
        checkSwitchboardFlag('appbuilder-rebuild-intake-form', request),
        checkSwitchboardFlag('appbuilder-debug-drawer', request),
        checkSwitchboardFlag('appbuilder-marketing-campaigns', request),
        checkSwitchboardFlag('appbuilder-google-business-profile-sync', request),
        checkSwitchboardFlag('appbuilder-asm-dual-write', request),
        checkSwitchboardFlag('appbuilder-logo-brand-colors', request),
        checkSwitchboardFlag('appbuilder-purchase-intent-classifier', request),
        checkSwitchboardFlag('appbuilder-skill-suggestions', request),
        checkSwitchboardFlag('appbuilder-rebuild-source-images', request),
        checkSwitchboardFlag('appbuilder-fix-session', request),
      ]);
      timing.parallelChecksMs = Date.now() - parallelStart;

      // Check site validation first — if error, return immediately
      if (siteResult.status === 'rejected') {
        throw siteResult.reason;
      }
      validationError = siteResult.value;
      if (!validationError) {
        setSiteValidationCache(user.customerId, body.siteId, body.owningProduct);
      }

      ({ canDownload, canPublish } = resolvePaywallResult(paywallResult, body.siteId, user.customerId, PaywallAction.Publish));
      if (!validationError) {
        logger.info('agent-token.control-plane.check-passed', {
          siteId: body.siteId,
          customerId: user.customerId,
          action: PaywallAction.Publish,
          cacheHit: false,
          durationMs: Date.now() - routeStart,
        });
      }
      canPurchaseDomain = resolveBooleanFlag(domainPurchaseResult, 'agent-token.domain-purchase-flag-check-failed', body.siteId, user.customerId);
      useTestBudget = resolveBooleanFlag(testBudgetResult, 'agent-token.test-budget-flag-check-failed', body.siteId, user.customerId);
      budgetServiceEnabled = resolveBooleanFlag(budgetServiceResult, 'agent-token.budget-service-flag-check-failed', body.siteId, user.customerId);
      bmsExistingEnabled = resolveBooleanFlag(bmsExistingResult, 'agent-token.bms-existing-flag-check-failed', body.siteId, user.customerId);
      subscriptionId = resolveSubscriptionId(siteInfoResult, body.siteId, user.customerId);
      fqdn = resolveFqdn(siteInfoResult, body.siteId, user.customerId);
      enableAssessmentAgent = resolveBooleanFlag(assessmentAgentResult, 'agent-token.assessment-agent-flag-check-failed', body.siteId, user.customerId);
      enableAssessmentOverride = resolveBooleanFlag(assessmentOverrideResult, 'agent-token.assessment-override-flag-check-failed', body.siteId, user.customerId);
      const rawAssessmentClassifierMiss = resolveStringFlag(assessmentClassifierResult, 'agent-token.assessment-classifier-flag-check-failed', body.siteId, user.customerId);
      assessmentClassifier = rawAssessmentClassifierMiss || undefined;
      modelSelectorEnabled = resolveBooleanFlag(modelSelectorResult, 'agent-token.model-selector-flag-check-failed', body.siteId, user.customerId);
      const rawModelOverride = resolveStringFlag(modelOverrideResult, 'agent-token.model-override-flag-check-failed', body.siteId, user.customerId);
      modelOverride = rawModelOverride && rawModelOverride !== 'default' ? rawModelOverride : undefined;
      agentProfileSelectorEnabled = resolveBooleanFlag(agentProfileSelectorResult, 'agent-token.agent-profile-selector-flag-check-failed', body.siteId, user.customerId);
      const rawAgentProfile = resolveStringFlag(agentProfileResult, 'agent-token.agent-profile-flag-check-failed', body.siteId, user.customerId);
      // Sentinels 'default' and 'hivemind' both mean "no operator override — let the
      // initial-agent Hivemind experiment decide". Any other value is an explicit
      // operator override (deployed default OR a targeted internal-account override)
      // and wins over the experiment.
      agentProfile = rawAgentProfile && rawAgentProfile !== 'default' && rawAgentProfile !== 'hivemind' ? rawAgentProfile : undefined;
      costAttributionDryRun = resolveBooleanFlag(costAttributionDryRunResult, 'agent-token.cost-attribution-dry-run-flag-check-failed', body.siteId, user.customerId);
      siteInfo = resolveSiteInfoFromGetSite(siteInfoResult, body.siteId, user.customerId);
      useAtlasCrawler = resolveBooleanFlag(useAtlasCrawlerResult, 'agent-token.atlas-crawler-flag-check-failed', body.siteId, user.customerId);
      rebuildIntakeFormEnabled = resolveBooleanFlag(rebuildIntakeFormResult, 'agent-token.rebuild-intake-form-flag-check-failed', body.siteId, user.customerId);
      debugStatsEnabled = resolveBooleanFlag(debugDrawerResult, 'agent-token.debug-drawer-flag-check-failed', body.siteId, user.customerId);
      marketingCampaignsEnabled = resolveBooleanFlag(marketingCampaignsResult, 'agent-token.marketing-campaigns-flag-check-failed', body.siteId, user.customerId);
      googleBusinessProfileSyncEnabled = resolveBooleanFlag(googleBusinessProfileSyncResult, 'agent-token.google-business-profile-sync-flag-check-failed', body.siteId, user.customerId);
      asmDualWriteEnabled = resolveBooleanFlag(asmDualWriteResult, 'agent-token.asm-dual-write-flag-check-failed', body.siteId, user.customerId);
      logoBrandColorsEnabled = resolveBooleanFlag(logoBrandColorsResult, 'agent-token.logo-brand-colors-flag-check-failed', body.siteId, user.customerId);
      purchaseIntentClassifierEnabled = resolveBooleanFlag(purchaseIntentClassifierResult, 'agent-token.purchase-intent-classifier-flag-check-failed', body.siteId, user.customerId);
      skillSuggestionsEnabled = resolveBooleanFlag(skillSuggestionsResult, 'agent-token.skill-suggestions-flag-check-failed', body.siteId, user.customerId);
      rebuildSourceImagesEnabled = resolveBooleanFlag(rebuildSourceImagesResult, 'agent-token.rebuild-source-images-flag-check-failed', body.siteId, user.customerId);
      enableFixSession = resolveBooleanFlag(fixSessionResult, 'agent-token.fix-session-flag-check-failed', body.siteId, user.customerId);
    }

    const hivemindCohorts = await fetchHivemindCohorts(request);

    // Hivemind initial-agent experiment: cohort → agent profile.
    //
    // Precedence (top wins):
    //   1. Per-project frontend override          (applied agent-side by resolveProfile)
    //   2. appbuilder-agent-profile switchboard    (real profile name only)
    //   3. Hivemind cohort mapping                 (when switchboard is undefined or
    //                                              returned a 'default' / 'hivemind' sentinel)
    //   4. (no profile)
    //
    // The switchboard sentinels 'default' and 'hivemind' are filtered to undefined
    // above, which is what allows the experiment to run for normal users while
    // targeted internal-account overrides (real profile names) keep working.
    //
    // We resolve the cohort regardless of whether we end up applying the mapping so
    // that every assigned user is logged as triggered for the experiment denominator.
    const initialAgentCohort = normalizeHivemindCohort(hivemindCohorts?.[EXPERIMENT_IDS.initialAgent]);
    if (initialAgentCohort && initialAgentCohort !== 'ineligible' && initialAgentCohort !== 'unassigned' && initialAgentCohort !== 'not_bucketed') {
      logger.info('hivemind.experiment.triggered', {
        experimentId: EXPERIMENT_IDS.initialAgent,
        cohortId: initialAgentCohort,
        siteId: body.siteId,
        customerId: user.customerId,
      });
      if (!agentProfile) {
        const mappedProfile = INITIAL_AGENT_COHORT_TO_PROFILE[initialAgentCohort];
        if (mappedProfile) {
          agentProfile = mappedProfile;
        }
      }
    }

    // Searchable log of the resolved agent profile from Switchboard/Hivemind.
    // Grep: `agent-token.profile.resolved`
    logger.info('agent-token.profile.resolved', {
      siteId: body.siteId,
      customerId: user.customerId,
      shopperId: user.shopperId,
      agentProfile: agentProfile ?? null,
    });

    // PaaS has its own billing model outside of the Airo Plus paywall, so the
    // AAB paywall must not gate publishes or downloads for PaaS apps.
    if (body.owningProduct === AIRO_OWNER_PRODUCTS.PAAS_NODEJS && !canPublish) {
      logger.info('agent-token.paas-publish-bypass', {
        siteId: body.siteId,
        customerId: user.customerId,
        owningProduct: body.owningProduct,
      });
      canPublish = true;
    }
    if (body.owningProduct === AIRO_OWNER_PRODUCTS.PAAS_NODEJS && !canDownload) {
      logger.info('agent-token.paas-download-bypass', {
        siteId: body.siteId,
        customerId: user.customerId,
        owningProduct: body.owningProduct,
      });
      canDownload = true;
    }

    // Invited users on shared apps (sharedWithMe) are operating under the app
    // owner's subscription — the paywall's billing gate must not block them.
    // Instead, derive canPublish / canDownload from FGA relations: the Team
    // panel controls what each invited user is allowed to do, and those grants
    // live in OpenFGA, not in the user's (empty) subscription record.
    if (siteInfo?.sharedWithMe) {
      const ventureId = siteInfo.team_venture_id;
      const fgaCfg = ventureId ? getAuthzFgaConfig() : null;
      if (fgaCfg && ventureId) {
        try {
          const accessToken = await getAuthzFgaAccessToken(fgaCfg);
          const userTuple = `customer:${user.customerId}`;
          // Use listObjects (not checkPermission) — FGA Check resolves
          // computed relations incorrectly on this store configuration.
          const [publishVentures, downloadVentures] = await Promise.all([
            fgaListObjects(fgaCfg, accessToken, { user: userTuple, relation: AUTHZ_FGA_RELATIONS.canPublish, type: 'venture' }),
            fgaListObjects(fgaCfg, accessToken, { user: userTuple, relation: AUTHZ_FGA_RELATIONS.canDownload, type: 'venture' }),
          ]);
          const publishAllowed = publishVentures.includes(ventureId);
          const downloadAllowed = downloadVentures.includes(ventureId);

          // Owner-pays gate: the collaborator's FGA grant is necessary but not
          // sufficient. The action must also be permitted by the OWNER's
          // subscription (the app's subscription_id), or a FREE owner's app
          // could be published by any collaborator holding the publish
          // relation — bypassing the paywall. Short-circuit the owner fetch
          // when the collaborator has no grant at all. Fail closed if the
          // owner's subscription is unknown or the lookup fails.
          if (!publishAllowed && !downloadAllowed) {
            canPublish = false;
            canDownload = false;
          } else if (!subscriptionId) {
            logger.warn('agent-token.shared-app-owner-subscription-missing', {
              siteId: body.siteId,
              customerId: user.customerId,
              action: PaywallAction.Publish,
              ventureId,
            });
            canPublish = false;
            canDownload = false;
          } else {
            const { ownerAllowsPublish, ownerAllowsDownload } = await resolveOwnerPaywall({
              subscriptionId,
              jwt: authContext.jwt || '',
            });
            canPublish = publishAllowed && ownerAllowsPublish;
            canDownload = downloadAllowed && ownerAllowsDownload;
            logger.info('agent-token.shared-app-fga-paywall-override', {
              siteId: body.siteId,
              customerId: user.customerId,
              ventureId,
              subscriptionId,
              publishAllowed,
              downloadAllowed,
              ownerAllowsPublish,
              ownerAllowsDownload,
              canPublish,
              canDownload,
            });
          }
        } catch (err) {
          logger.warn('agent-token.shared-app-fga-check-failed', {
            siteId: body.siteId,
            customerId: user.customerId,
            action: PaywallAction.Publish,
            error: err instanceof Error ? err.message : String(err),
          });
          // Fail closed on FGA error — don't grant permissions we can't verify
          canPublish = false;
          canDownload = false;
        }
      } else {
        // No FGA config or venture id — can't verify, fail closed
        canPublish = false;
        canDownload = false;
      }
    }

    // Three-lever BMS migration check (see checkBmsMigration for details)
    // Either flag enables BMS: budgetServiceEnabled (new users) OR bmsExistingEnabled (migrated users)
    // If fetch fails, bmsBudgetId stays undefined (cost assigned to GoDaddy)
    let bmsBudgetId: string | undefined;
    const bmsMigrationFlags = {
      budgetServiceEnabled,
      bmsExistingEnabled,
    };
    if (shouldCheckBmsMigration(bmsMigrationFlags) && subscriptionId) {
      try {
        const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
        const mgmtClient = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt || '' });
        const subscription = await mgmtClient.getSubscription(subscriptionId, { includeAttributes: true });

        const bmsResult = checkBmsMigration(subscription, bmsMigrationFlags);

        if (bmsResult.useBms) {
          bmsBudgetId = bmsResult.bmsBudgetId;
          budgetServiceEnabled = true; // Enable BMS mode in JWT for agents service
          logger.info('agent-token.bms-enabled', {
            siteId: body.siteId,
            customerId: user.customerId,
            subscriptionId,
            bmsBudgetId,
            migrationDate: getMigrationDate(subscription),
            reason: bmsResult.path,
          });
        } else {
          budgetServiceEnabled = false;
          logger.info('agent-token.bms-disabled', {
            siteId: body.siteId,
            customerId: user.customerId,
            subscriptionId,
            reason: bmsResult.reason,
          });
        }
      } catch (err) {
        logger.error('agent-token.bms-budget-id-fetch-failed', {
          siteId: body.siteId,
          customerId: user.customerId,
          subscriptionId,
          error: err instanceof Error ? err.message : 'Unknown',
        });
        // bmsBudgetId stays undefined → cost assigned to GoDaddy
        budgetServiceEnabled = false;
      }
    }

    // Enforce dependency: enableAssessmentOverride and enableFixSession require enableAssessmentAgent
    // If agent is disabled, override/session can't function (classification is short-circuited)
    enableAssessmentOverride = enableAssessmentAgent && enableAssessmentOverride;
    enableFixSession = enableAssessmentAgent && enableFixSession;

    // CRM skip / impersonation sessions (e2s, e2s2s) always get the model selector
    // regardless of the switchboard flag — matches the bypass patterns used in
    // Feedback.tsx and ChatPane.tsx for impersonated sessions.
    let careAgentId: string | undefined;
    let careAgentUsernameHash: string | undefined;
    if (isEmployeeAuthType(user.authType)) {
      if (!modelSelectorEnabled) {
        logger.info('agent-token.model-selector-forced-for-impersonation', {
          siteId: body.siteId,
          customerId: user.customerId,
          authType: user.authType,
        });
      }
      modelSelectorEnabled = true;

      if (authContext.jwt) {
        // careAgentId gets resolved using workers-service api call
        // careAgentUsernameHash is used as fallback, only available when
        // workers-service api call fails
        const careAgentUsername: string | undefined =
          extractDelegatedEmployee(authContext.jwt) ?? undefined;
        ({ careAgentId, careAgentUsernameHash } = await resolveCareAgentIdentity({
          jwt: authContext.jwt,
          headers: request.headers,
          accountName: careAgentUsername,
        }));
      }
    }

    timing.siteAccessMs = Date.now() - siteAccessStart;
    timing.siteAccessCacheHit = siteValidationCacheHit ? 1 : 0;

    if (validationError) {
      return validationError;
    }

    // Resolve (or lazily create) the app's team venture WITHOUT mutating the
    // shared siteInfo — build a copy so downstream reads (FGA enforce, isOwner)
    // see the venture without an in-place mutation crossing this boundary.
    //
    // Always invoked — even when team_venture_id already exists — so the
    // venture->app mapping backstop inside ensureAppTeamVenture runs on every
    // owner open. That is the reliable trigger that lets invitee-pull resolve
    // this venture; short-circuiting here when the venture exists (the old
    // behavior) meant the mapping was never (re)written for already-provisioned
    // apps, so invited collaborators stayed invisible until the owner reopened
    // the Team panel. When the venture exists the function re-asserts the mapping
    // (best-effort, owner-only) and returns the existing id; otherwise it lazily
    // creates the venture as before.
    const resolvedVentureId = await ensureAppTeamVenture({
      multiUserEnabled,
      siteId: body.siteId,
      customerId: user.customerId,
      jwt: authContext.jwt || '',
      siteInfo,
    });
    const resolvedSiteInfo =
      resolvedVentureId && siteInfo
        ? { ...siteInfo, team_venture_id: resolvedVentureId }
        : siteInfo;

    const fgaDeny = await enforceAabMultiUserCanBuild({
      request,
      siteId: body.siteId,
      customerId: user.customerId,
      siteInfo: resolvedSiteInfo,
    });
    if (fgaDeny) {
      return fgaDeny;
    }

    // Auth-at-Edge SSO claims — bake at mint time so the agents/ middleware
    // can refuse direct publishes without a per-request HTTP call.
    //   ssoRequired = the app's apps.sso_required flag from mhp-core (admin-
    //                 controlled). Read from resolvedSiteInfo (already in
    //                 hand from the cache-hit/cache-miss paths above).
    //   ssoConfigured = both credential pointer rows present in hosting's
    //                   auth-class group. Looked up via airo-go's customer-
    //                   proxy GET secrets (mhp-core PR #738 confirmed the
    //                   auth group surfaces via passthrough). Skipped when
    //                   ssoRequired is false (no value to gate on).
    // Both fail safe to false on any error — keeps non-ent flows unaffected
    // and matches the canonical hosting publish gate's defense posture.
    const ssoRequired = resolvedSiteInfo?.ssoRequired === true;
    let ssoConfigured = false;
    if (ssoRequired && resolvedSiteInfo?.subscription_id && resolvedSiteInfo?.system_id) {
      try {
        const { clientIdSecretName, clientSecretSecretName } = resolveSsoPointerNames(resolvedSiteInfo);
        const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
        const mgmtClient = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt || '' });
        const raw = await mgmtClient.getSecrets(resolvedSiteInfo.subscription_id, resolvedSiteInfo.system_id, body.siteId);
        const authSecrets = raw.auth?.secrets ?? [];
        const names = new Set<string>(
          authSecrets
            .map((s) => (typeof s.name === 'string' ? s.name.toLowerCase() : undefined))
            .filter((n): n is string => typeof n === 'string'),
        );
        ssoConfigured = names.has(clientIdSecretName.toLowerCase()) && names.has(clientSecretSecretName.toLowerCase());
      } catch (err) {
        logger.warn('agent-token.sso-config-presence.fetch-failed', {
          siteId: body.siteId,
          customerId: user.customerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const jwtStart = Date.now();
    const jwtService = getJWTService();
    const product = body.owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
    const maxSignalClaimLen = 256;
    const visitorRaw = request.cookies.get('visitor')?.value;
    let visitorIdFromCookie = visitorIdFromVisitorCookieRaw(visitorRaw);
    if (visitorRaw && !visitorIdFromCookie) {
      logger.warn('agent-token.visitor-id-parse-miss', { siteId: body.siteId });
    }
    if (visitorIdFromCookie && visitorIdFromCookie.length > maxSignalClaimLen) {
      logger.warn('agent-token.visitor-id-truncated', {
        siteId: body.siteId,
        length: visitorIdFromCookie.length,
        max: maxSignalClaimLen,
      });
      visitorIdFromCookie = visitorIdFromCookie.slice(0, maxSignalClaimLen);
    }
    const pathwayFromJar = request.cookies.get('pathway')?.value;
    let trafficSessionId = trafficPathwaySessionId(pathwayFromJar);
    if (pathwayFromJar && !trafficSessionId) {
      logger.warn('agent-token.traffic-session-id-parse-miss', { siteId: body.siteId });
    }
    if (trafficSessionId && trafficSessionId.length > maxSignalClaimLen) {
      logger.warn('agent-token.traffic-session-id-truncated', {
        siteId: body.siteId,
        length: trafficSessionId.length,
        max: maxSignalClaimLen,
      });
      trafficSessionId = trafficSessionId.slice(0, maxSignalClaimLen);
    }
    const tokenOptions = {
      siteId: body.siteId,
      customerId: user.customerId,
      shopperId: user.shopperId,
      ...(visitorIdFromCookie && { visitorId: visitorIdFromCookie }),
      ...(trafficSessionId && { trafficSessionId }),
      ...(market && { market }),
      ...(fqdn && { fqdn }),
      canDownload,
      canPublish,
      canPurchaseDomain,
      ...(typeof resolvedSiteInfo?.owner_customer_id === 'string'
        ? { isOwner: resolvedSiteInfo.owner_customer_id === user.customerId }
        : {}),
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false,
      ...(careAgentId && { careAgentId }),
      ...(careAgentUsernameHash && { careAgentUsernameHash }),
      useTestBudget,
      budgetServiceEnabled,
      subscriptionId,
      bmsBudgetId,
      enableAssessmentAgent,
      enableAssessmentOverride,
      enableFixSession,
      assessmentClassifier,
      product,
      modelSelectorEnabled,
      modelOverride,
      agentProfileSelectorEnabled,
      agentProfile,
      costAttributionDryRun,
      useAtlasCrawler,
      rebuildIntakeFormEnabled,
      rebuildSourceImagesEnabled,
      debugStatsEnabled,
      marketingCampaignsEnabled,
      googleBusinessProfileSyncEnabled,
      asmDualWriteEnabled,
      logoBrandColorsEnabled,
      purchaseIntentClassifierEnabled,
      skillSuggestionsEnabled,
      ssoRequired,
      ssoConfigured,
      // Carry SiteInfo.ownerProduct into the agent JWT so the agent can
      // detect enterprise-managed apps (`aab-ent-v1`) and suppress
      // upgrade-plan copy in chat. Empty when SiteInfo omitted it.
      ownerProduct: resolvedSiteInfo?.ownerProduct,
    };

    const result = body.expiresInSeconds
      ? await jwtService.createToken(tokenOptions, body.expiresInSeconds)
      : await jwtService.getToken(tokenOptions);
    timing.jwtGenerationMs = Date.now() - jwtStart;

    timing.totalMs = Date.now() - routeStart;

    logger.info('agent-token.timing', {
      siteId: body.siteId,
      customerId: user.customerId,
      ...timing,
    });

    const response = {
      token: result.token,
      expires: result.expires.toISOString(),
      siteId: body.siteId,
      type: 'jwt' as const,
      budgetServiceEnabled,
      ...(body.expiresInSeconds && { expiresInSeconds: body.expiresInSeconds }),
    };

    return NextResponse.json(response);

  } catch (error) {
    // Log server-side (a failure before any sub-logger fires would otherwise
    // produce a 500 with no log line) and return a GENERIC detail — the raw
    // message can carry internal FGA / mgmt-airo error text we don't echo to clients.
    logger.error('agent-token.unhandled-error', {
      action: PaywallAction.Publish,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({
      error: 'Token creation failed',
      details: 'An unexpected error occurred. Please try again.'
    }, { status: 500 });
  }
});
