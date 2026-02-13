/**
 * Download API
 *
 * Handles export tracking and returns download URL for direct agent access.
 *
 * Flow:
 * 1. Authenticate customer
 * 2. Check paywall eligibility
 * 3. Record export to MHP-Airo (with customer JWT)
 * 4. Generate agent token
 * 5. Return download URL + token (client downloads directly from agent)
 *
 * This approach:
 * - Guarantees tracking happens before download URL is provided
 * - Avoids proxying large files through Next.js (cheaper, more reliable)
 * - Client downloads directly from agent
 */

import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth
} from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core';
import { ServerPaywallProvider } from '@/lib/paywall/server-provider';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

interface TrackingResult {
  tracked: boolean;
  exportId?: string;
  message?: string;
}

/**
 * Record export tracking to MHP-Airo
 *
 * Non-blocking - returns result but doesn't throw on failure.
 * Legacy sites without V2 metadata will return tracked: false.
 */
async function recordExportTracking(
  siteId: string,
  authContext: CustomerAuthContext,
  siteName?: string
): Promise<TrackingResult> {
  const { user, jwt } = authContext;

  try {
    // Get site to check for V2 metadata
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, jwt);

    if (!site) {
      return { tracked: false, message: 'Site not found' };
    }

    // Legacy sites don't have V2 metadata - tracking skipped
    if (!site.subscription_id || !site.system_id) {
      logger.debug('download.tracking.legacy-site', {
        siteId,
        hasSubscriptionId: !!site.subscription_id,
        hasSystemId: !!site.system_id,
      });
      return { tracked: false, message: 'Legacy site - no tracking metadata' };
    }

    if (!jwt) {
      return { tracked: false, message: 'No JWT available' };
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt });

    const initiatedBy = user.customerId || 'unknown';
    const authType = user.authType || 'basic';
    const isDelegated = authType === 'e2s' || authType === 's2s';

    const exportData = {
      initiatedBy,
      exportedAt: new Date().toISOString(),
      appName: siteName || site.name || siteId,
      metadata: {
        format: 'zip',
        isDelegated,
        source: 'download-proxy' // Distinguish from direct API calls
      }
    };

    logger.info('download.tracking.start', {
      siteId,
      subscriptionId: site.subscription_id,
      systemId: site.system_id,
      initiatedBy,
    });

    const response = await client.recordExport(
      site.subscription_id,
      site.system_id,
      siteId,
      exportData
    );

    if (!response) {
      logger.warn('download.tracking.failed', {
        siteId,
        subscriptionId: site.subscription_id,
        message: 'MHP-Airo recordExport returned null'
      });
      return { tracked: false, message: 'MHP-Airo call failed' };
    }

    logger.info('download.tracking.success', {
      siteId,
      exportId: response.id,
      subscriptionId: site.subscription_id,
    });

    return { tracked: true, exportId: response.id };

  } catch (error) {
    logger.warn('download.tracking.error', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { tracked: false, message: 'Tracking request failed' };
  }
}

/**
 * POST /api/apps/[id]/download
 *
 * Initiates app download with guaranteed export tracking.
 *
 * Response: JSON with download URL and token for direct agent access
 * {
 *   downloadUrl: string,
 *   token: string,
 *   filename: string,
 *   tracked: boolean,
 *   exportId?: string
 * }
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id: siteId } = await params;
  const { user, jwt } = authContext;

  try {
    // Validate user has account
    if (!customerHasAccount(user)) {
      return createCustomerAuthError(
        'You must have an account to download apps',
        403
      );
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    if (!jwt) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    logger.info('download.proxy.start', { siteId, customerId: user.customerId });

    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    if (!site.agent_url) {
      return NextResponse.json(
        { error: 'Site agent is not available. Please wait for deployment to complete.' },
        { status: 503 }
      );
    }

    let canDownload = false;
    try {
      const provider = new ServerPaywallProvider(jwt, user.customerId, request.headers);
      const eligibility = await checkPaywallEligibility(provider, siteId, PaywallAction.Download);
      canDownload = eligibility.hasAccess;

      if (!canDownload) {
        logger.info('download.proxy.paywall-blocked', {
          siteId,
          customerId: user.customerId,
          reason: eligibility.reason,
        });
        return NextResponse.json(
          { error: 'Download requires Paid subscription', reason: eligibility.reason },
          { status: 403 }
        );
      }
    } catch (error) {
      logger.error('download.proxy.paywall-error', {
        siteId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Unable to verify download eligibility' },
        { status: 500 }
      );
    }

    const trackingResult = await recordExportTracking(siteId, authContext, site.name);

    logger.info('download.proxy.tracking-complete', {
      siteId,
      tracked: trackingResult.tracked,
      exportId: trackingResult.exportId,
      message: trackingResult.message,
    });

    // Generate agent token for direct download
    const jwtService = getJWTService();
    const tokenResult = await jwtService.createToken({
      siteId,
      canDownload: true,
      canPublish: false,
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false,
    });

    const downloadUrl = `${site.agent_url}/apps/${siteId}/zip`;
    const filename = site.name
      ? `${site.name.replace(/[^a-zA-Z0-9-_]/g, '-')}.zip`
      : `app-${siteId}.zip`;

    logger.info('download.redirect.success', {
      siteId,
      agentUrl: site.agent_url,
      tracked: trackingResult.tracked,
      exportId: trackingResult.exportId,
    });

    // Return download URL and token for client to fetch directly from agent
    return NextResponse.json({
      downloadUrl,
      token: tokenResult.token,
      filename,
      tracked: trackingResult.tracked,
      exportId: trackingResult.exportId,
    });

  } catch (error) {
    logger.error('download.proxy.error', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Download failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
