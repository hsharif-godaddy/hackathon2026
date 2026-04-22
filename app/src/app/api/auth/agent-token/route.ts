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

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, type CustomerUser, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AIRO_OWNER_PRODUCTS, AiroMgmtClient } from '@/lib/mgmt-airo';
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core';
import { ServerPaywallProvider } from '@/lib/paywall/server-provider';
import { PaywallDenialReason } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag, checkSwitchboardValue } from '@/lib/switchboard/server';
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
async function validateSiteAccess(siteId: string, user: CustomerUser, jwt: string, owningProduct?: string): Promise<NextResponse | null> {
  if (!customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to create agent tokens', 403);
  }

  const adapter = getControlPlaneAdapter();
  const productFilter = owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
  const exists = await adapter.appExists(siteId, jwt, productFilter);

  if (!exists) {
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
  customerId: string
): { canDownload: boolean; canPublish: boolean } {
  if (result.status === 'rejected') {
    logger.error('agent-token.paywall-check-failed', {
      siteId,
      customerId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
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
  };

  if (canPublish || canDownload) {
    logger.info('agent-token.permissions-granted', {
      siteId,
      customerId,
      canPublish,
      canDownload,
      environment: process.env.NODE_ENV,
      ...eligibilityDetails,
    });
  } else {
    logger.info('agent-token.permissions-denied', {
      siteId,
      customerId,
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
    let subscriptionId: string | undefined;
    let enableAssessmentAgent = false;
    let enableAssessmentOverride = false;
    let modelSelectorEnabled = false;
    let modelOverride: string | undefined;
    let agentProfileSelectorEnabled = false;
    let agentProfile: string | undefined;

    if (siteValidationCacheHit) {
      // Cache hit: skip site validation, run paywall + switchboard + subscription lookup in parallel
      const parallelStart = Date.now();
      const [paywallResult, domainPurchaseResult, testBudgetResult, budgetServiceResult, siteInfoResult, assessmentAgentResult, assessmentOverrideResult, modelSelectorResult, modelOverrideResult, agentProfileSelectorResult, agentProfileResult] = await Promise.allSettled([
        checkPaywallEligibility(
          new ServerPaywallProvider(authContext.jwt || '', user.customerId, request.headers),
          body.siteId,
          PaywallAction.Publish
        ),
        checkSwitchboardFlag('appbuilder-domain-purchase', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-test-budget', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('app-builder-budget-service', authContext.jwt || '', request.headers),
        adapter.getSite(body.siteId, authContext.jwt || '', body.owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER),
        checkSwitchboardFlag('appbuilder-assessment-agent', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-assessment-override', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-model-selector', authContext.jwt || '', request.headers),
        checkSwitchboardValue('appbuilder-model-override', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-agent-profile-selector', authContext.jwt || '', request.headers),
        checkSwitchboardValue('appbuilder-agent-profile', authContext.jwt || '', request.headers),
      ]);
      timing.parallelChecksMs = Date.now() - parallelStart;

      ({ canDownload, canPublish } = resolvePaywallResult(paywallResult, body.siteId, user.customerId));
      canPurchaseDomain = resolveBooleanFlag(domainPurchaseResult, 'agent-token.domain-purchase-flag-check-failed', body.siteId, user.customerId);
      useTestBudget = resolveBooleanFlag(testBudgetResult, 'agent-token.test-budget-flag-check-failed', body.siteId, user.customerId);
      budgetServiceEnabled = resolveBooleanFlag(budgetServiceResult, 'agent-token.budget-service-flag-check-failed', body.siteId, user.customerId);
      subscriptionId = resolveSubscriptionId(siteInfoResult, body.siteId, user.customerId);
      enableAssessmentAgent = resolveBooleanFlag(assessmentAgentResult, 'agent-token.assessment-agent-flag-check-failed', body.siteId, user.customerId);
      enableAssessmentOverride = resolveBooleanFlag(assessmentOverrideResult, 'agent-token.assessment-override-flag-check-failed', body.siteId, user.customerId);
      modelSelectorEnabled = resolveBooleanFlag(modelSelectorResult, 'agent-token.model-selector-flag-check-failed', body.siteId, user.customerId);
      const rawModelOverride = resolveStringFlag(modelOverrideResult, 'agent-token.model-override-flag-check-failed', body.siteId, user.customerId);
      modelOverride = rawModelOverride && rawModelOverride !== 'default' ? rawModelOverride : undefined;
      agentProfileSelectorEnabled = resolveBooleanFlag(agentProfileSelectorResult, 'agent-token.agent-profile-selector-flag-check-failed', body.siteId, user.customerId);
      const rawAgentProfile = resolveStringFlag(agentProfileResult, 'agent-token.agent-profile-flag-check-failed', body.siteId, user.customerId);
      agentProfile = rawAgentProfile && rawAgentProfile !== 'default' ? rawAgentProfile : undefined;
    } else {
      // Cache miss: run site validation, paywall, switchboard, and subscription lookup all in parallel
      const parallelStart = Date.now();
      const [siteResult, paywallResult, domainPurchaseResult, testBudgetResult, budgetServiceResult, siteInfoResult, assessmentAgentResult, assessmentOverrideResult, modelSelectorResult, modelOverrideResult, agentProfileSelectorResult, agentProfileResult] = await Promise.allSettled([
        validateSiteAccess(body.siteId, user, authContext.jwt || '', body.owningProduct),
        checkPaywallEligibility(
          new ServerPaywallProvider(authContext.jwt || '', user.customerId, request.headers),
          body.siteId,
          PaywallAction.Publish
        ),
        checkSwitchboardFlag('appbuilder-domain-purchase', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-test-budget', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('app-builder-budget-service', authContext.jwt || '', request.headers),
        adapter.getSite(body.siteId, authContext.jwt || '', body.owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER),
        checkSwitchboardFlag('appbuilder-assessment-agent', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-assessment-override', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-model-selector', authContext.jwt || '', request.headers),
        checkSwitchboardValue('appbuilder-model-override', authContext.jwt || '', request.headers),
        checkSwitchboardFlag('appbuilder-agent-profile-selector', authContext.jwt || '', request.headers),
        checkSwitchboardValue('appbuilder-agent-profile', authContext.jwt || '', request.headers),
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

      ({ canDownload, canPublish } = resolvePaywallResult(paywallResult, body.siteId, user.customerId));
      canPurchaseDomain = resolveBooleanFlag(domainPurchaseResult, 'agent-token.domain-purchase-flag-check-failed', body.siteId, user.customerId);
      useTestBudget = resolveBooleanFlag(testBudgetResult, 'agent-token.test-budget-flag-check-failed', body.siteId, user.customerId);
      budgetServiceEnabled = resolveBooleanFlag(budgetServiceResult, 'agent-token.budget-service-flag-check-failed', body.siteId, user.customerId);
      subscriptionId = resolveSubscriptionId(siteInfoResult, body.siteId, user.customerId);
      enableAssessmentAgent = resolveBooleanFlag(assessmentAgentResult, 'agent-token.assessment-agent-flag-check-failed', body.siteId, user.customerId);
      enableAssessmentOverride = resolveBooleanFlag(assessmentOverrideResult, 'agent-token.assessment-override-flag-check-failed', body.siteId, user.customerId);
      modelSelectorEnabled = resolveBooleanFlag(modelSelectorResult, 'agent-token.model-selector-flag-check-failed', body.siteId, user.customerId);
      const rawModelOverride = resolveStringFlag(modelOverrideResult, 'agent-token.model-override-flag-check-failed', body.siteId, user.customerId);
      modelOverride = rawModelOverride && rawModelOverride !== 'default' ? rawModelOverride : undefined;
      agentProfileSelectorEnabled = resolveBooleanFlag(agentProfileSelectorResult, 'agent-token.agent-profile-selector-flag-check-failed', body.siteId, user.customerId);
      const rawAgentProfile = resolveStringFlag(agentProfileResult, 'agent-token.agent-profile-flag-check-failed', body.siteId, user.customerId);
      agentProfile = rawAgentProfile && rawAgentProfile !== 'default' ? rawAgentProfile : undefined;
    }

    // Fetch bmsBudgetId from subscription when budget service is enabled
    // If fetch fails, bmsBudgetId stays undefined (cost assigned to GoDaddy)
    let bmsBudgetId: string | undefined;
    if (budgetServiceEnabled && subscriptionId) {
      try {
        const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
        const mgmtClient = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt || '' });
        const subscription = await mgmtClient.getSubscription(subscriptionId);
        bmsBudgetId = subscription.bmsBudgetId ?? undefined;
      } catch (err) {
        logger.error('agent-token.bms-budget-id-fetch-failed', {
          siteId: body.siteId,
          customerId: user.customerId,
          subscriptionId,
          error: err instanceof Error ? err.message : 'Unknown',
        });
        // bmsBudgetId stays undefined → cost assigned to GoDaddy
      }
    }
    // Enforce dependency: enableAssessmentOverride requires enableAssessmentAgent
    // If agent is disabled, override can't function (classification is short-circuited)
    enableAssessmentOverride = enableAssessmentAgent && enableAssessmentOverride;

    // CRM skip / impersonation sessions (e2s, e2s2s) always get the model selector
    // regardless of the switchboard flag — matches the bypass patterns used in
    // Feedback.tsx and ChatPane.tsx for impersonated sessions.
    if (isEmployeeAuthType(user.authType)) {
      if (!modelSelectorEnabled) {
        logger.info('agent-token.model-selector-forced-for-impersonation', {
          siteId: body.siteId,
          customerId: user.customerId,
          authType: user.authType,
        });
      }
      modelSelectorEnabled = true;
    }

    timing.siteAccessMs = Date.now() - siteAccessStart;
    timing.siteAccessCacheHit = siteValidationCacheHit ? 1 : 0;

    if (validationError) {
      return validationError;
    }

    const jwtStart = Date.now();
    const jwtService = getJWTService();
    const product = body.owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
    const tokenOptions = {
      siteId: body.siteId,
      customerId: user.customerId,
      canDownload,
      canPublish,
      canPurchaseDomain,
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false,
      useTestBudget,
      budgetServiceEnabled,
      subscriptionId,
      bmsBudgetId,
      enableAssessmentAgent,
      enableAssessmentOverride,
      product,
      modelSelectorEnabled,
      modelOverride,
      agentProfileSelectorEnabled,
      agentProfile,
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

    const response: Record<string, unknown> = {
      token: result.token,
      expires: result.expires.toISOString(),
      siteId: body.siteId,
      type: 'jwt'
    };

    if (body.expiresInSeconds) {
      response.expiresInSeconds = body.expiresInSeconds;
    }

    return NextResponse.json(response);

  } catch (error) {
    return NextResponse.json({
      error: 'Token creation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
});
