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

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, type CustomerUser, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AIRO_OWNER_PRODUCTS } from '@/lib/mgmt-airo';
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core';
import { ServerPaywallProvider } from '@/lib/paywall/server-provider';
import { PaywallDenialReason } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { SiteAdapterFactory } from '@/lib/site-adapters/SiteAdapterFactory';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { getSiteValidationFromCache, setSiteValidationCache } from './site-validation-cache';

export interface CreateAgentTokenRequest {
  siteId: string;
  expiresInSeconds?: number;
  owningProduct?: string;
}

export const dynamic = 'force-dynamic';

/**
 * Maximum allowed expiration time in seconds (12 hours)
 */
const MAX_EXPIRATION_SECONDS = 12 * 60 * 60; // 43200 seconds

/**
 * Validate and retrieve site using V2 control plane adapter
 */
async function getSiteV2(siteId: string, user: CustomerUser, jwt: string, owningProduct?: string): Promise<NextResponse | null> {
  if (!customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to create agent tokens', 403);
  }

  const adapter = getControlPlaneAdapter();
  const productFilter = owningProduct || AIRO_OWNER_PRODUCTS.AIRO_APP_BUILDER;
  const site = await adapter.getSite(siteId, jwt, productFilter);

  if (!site) {
    return NextResponse.json({
      error: 'Site not found'
    }, { status: 404 });
  }

  return null;
}

/**
 * Validate and retrieve site using legacy site adapter
 */
async function getSiteLegacy(siteId: string, user: CustomerUser): Promise<NextResponse | null> {
  const siteAdapter = SiteAdapterFactory.getInstance();

  if (siteAdapter.requiresAuth() && !customerHasAccount(user)) {
    return createCustomerAuthError('You must have an account to create agent tokens', 403);
  }

  const site = await siteAdapter.getSiteById(siteId);

  if (!site) {
    return NextResponse.json({
      error: 'Site not found'
    }, { status: 404 });
  }

  if (siteAdapter.requiresAuth() && site.account_id !== user.accountId) {
    return createCustomerAuthError('You can only create tokens for your own sites', 403);
  }

  return null;
}

/**
 * Validate site access and ownership based on control plane mode
 */
async function validateSiteAccess(siteId: string, user: CustomerUser, jwt: string, owningProduct?: string): Promise<NextResponse | null> {
  const isV2 = isV2ControlPlaneEnabled();
  return isV2 ? await getSiteV2(siteId, user, jwt, owningProduct) : await getSiteLegacy(siteId, user);
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

    const siteAccessStart = Date.now();
    const cacheHit = getSiteValidationFromCache(user.customerId, body.siteId, body.owningProduct);
    let validationError: NextResponse | null = null;
    if (!cacheHit) {
      validationError = await validateSiteAccess(body.siteId, user, authContext.jwt || '', body.owningProduct);
      if (!validationError) {
        setSiteValidationCache(user.customerId, body.siteId, body.owningProduct);
      }
    }
    timing.siteAccessMs = Date.now() - siteAccessStart;
    timing.siteAccessCacheHit = cacheHit ? 1 : 0;

    if (validationError) {
      return validationError;
    }

    // Check paywall eligibility to determine permissions
    let canDownload = false;
    let canPublish = false;
    let canPurchaseDomain = false;
    let eligibilityDetails: Record<string, unknown> = {};

    const paywallStart = Date.now();
    try {
      const provider = new ServerPaywallProvider(
        authContext.jwt || '',
        user.customerId,
        request.headers
      );
      const eligibility = await checkPaywallEligibility(provider, body.siteId, PaywallAction.Publish);

      // Publish requires passing publish limit check, download does not
      canPublish = eligibility.hasAccess;
      // Allow download even if publish limit reached, but only if user has a paid subscription
      // This prevents free users (limit=0) from getting download access via this bypass
      canDownload = eligibility.hasAccess || (
        eligibility.reason === PaywallDenialReason.PublishLimitReached &&
        eligibility.details.hasSubscription
      );

      eligibilityDetails = {
        hasAccess: eligibility.hasAccess,
        reason: eligibility.reason,
        hasSubscription: eligibility.details.hasSubscription,
        hasEntitlements: eligibility.details.hasEntitlements,
        hasMatchingProject: eligibility.details.hasMatchingProject,
      };

      // Log permission grants with full context for security auditing
      if (canPublish || canDownload) {
        logger.info('agent-token.permissions-granted', {
          siteId: body.siteId,
          customerId: user.customerId,
          canPublish,
          canDownload,
          environment: process.env.NODE_ENV,
          ...eligibilityDetails,
        });
      } else {
        logger.info('agent-token.permissions-denied', {
          siteId: body.siteId,
          customerId: user.customerId,
          ...eligibilityDetails,
        });
      }
    } catch (error) {
      // Fail closed - deny permissions if check fails
      logger.error('agent-token.paywall-check-failed', {
        siteId: body.siteId,
        customerId: user.customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      canDownload = false;
      canPublish = false;
    }
    timing.paywallCheckMs = Date.now() - paywallStart;

    // Check domain purchase feature flag (fail closed - deny if check fails)
    const switchboardStart = Date.now();
    try {
      canPurchaseDomain = await checkSwitchboardFlag(
        'appbuilder-domain-purchase',
        authContext.jwt || '',
        request.headers
      );
    } catch (error) {
      logger.warn('agent-token.domain-purchase-flag-check-failed', {
        siteId: body.siteId,
        customerId: user.customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      canPurchaseDomain = false;
    }
    timing.switchboardMs = Date.now() - switchboardStart;

    const jwtStart = Date.now();
    const jwtService = getJWTService();
    const tokenOptions = {
      siteId: body.siteId,
      canDownload,
      canPublish,
      canPurchaseDomain,
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false
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
