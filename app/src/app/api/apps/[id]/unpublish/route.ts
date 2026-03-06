import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter, isV2ControlPlaneEnabled } from '@/lib/control-plane';
import { DomainType } from '@/lib/control-plane/types';
import {
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';

/**
 * Request body for unpublish endpoint
 */
interface UnpublishRequestBody {
  /** Whether to disconnect custom domain before unpublishing */
  disconnectDomain?: boolean;
  /** The FQDN of the domain to disconnect */
  domainFqdn?: string;
}

/**
 * POST /api/apps/[id]/unpublish
 *
 * Unpublishes an app by:
 * 1. Optionally disconnecting custom domain
 * 2. Calling agents service to remove publish symlink (local dev)
 * 3. Calling control plane to mark publish variant as inactive (V2)
 *
 * The app reverts to showing a Coming Soon page. Re-publishing restores it.
 *
 * Request body: { disconnectDomain?: boolean, domainFqdn?: string }
 * Response: { success: true, message: string } or error with retryable flag
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id: siteId } = await params;
  let body: UnpublishRequestBody = {};

  try {
    body = await request.json();
  } catch {
    // Empty body is fine - no options needed
  }

  try {
    const { user } = authContext;

    // Check feature flag
    if (!authContext.jwt) {
      return NextResponse.json(
        { error: 'Authentication token required' },
        { status: 401 }
      );
    }

    const isFeatureEnabled = await checkSwitchboardFlag(
      'appbuilder-unpublish',
      authContext.jwt,
      request.headers
    );

    if (!isFeatureEnabled) {
      logger.warn('unpublish.api.feature_disabled', {
        siteId,
        message: 'Unpublish feature is not enabled',
      });
      return NextResponse.json(
        { error: 'Feature not available' },
        { status: 403 }
      );
    }

    // Customer must have an account to unpublish
    if (!customerHasAccount(user)) {
      return NextResponse.json(
        { error: 'You must have an account to unpublish apps' },
        { status: 403 }
      );
    }

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Get site from control plane adapter (handles auth and ownership)
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(siteId, authContext.jwt);

    if (!site) {
      return NextResponse.json(
        { error: 'Site not found' },
        { status: 404 }
      );
    }

    const isV2 = isV2ControlPlaneEnabled();

    logger.info('unpublish.api.start', {
      siteId,
      isV2,
      disconnectDomain: body.disconnectDomain,
      domainFqdn: body.domainFqdn,
    });

    // Step 1: Optionally disconnect custom domain first
    let domainJobId: string | undefined;
    let domainDisconnectFailed = false;
    if (body.disconnectDomain && body.domainFqdn && isV2 && site.subscription_id && site.system_id) {
      // Validate that the domain belongs to this site and is a custom domain
      const customDomain = site.domains?.find(
        (d) => d.fqdn === body.domainFqdn && d.domainType === DomainType.CUSTOM
      );

      if (!customDomain) {
        logger.warn('unpublish.api.disconnect_domain.invalid', {
          siteId,
          domainFqdn: body.domainFqdn,
          availableDomains: site.domains?.map((d) => ({ fqdn: d.fqdn, type: d.domainType })),
        });
        return NextResponse.json(
          { error: 'Domain not found on this site or is not a custom domain' },
          { status: 400 }
        );
      }

      try {
        logger.info('unpublish.api.disconnect_domain.start', {
          siteId,
          domainFqdn: body.domainFqdn,
        });

        const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
        const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

        const domainResponse = await client.modifyDomains(
          site.subscription_id,
          site.system_id,
          siteId,
          {
            domainsToDelete: [{ fqdn: body.domainFqdn }],
          }
        );

        domainJobId = domainResponse.statusJobId;

        logger.info('unpublish.api.disconnect_domain.success', {
          siteId,
          domainFqdn: body.domainFqdn,
          domainJobId,
        });
      } catch (domainError) {
        domainDisconnectFailed = true;
        logger.error('unpublish.api.disconnect_domain.failed', {
          siteId,
          domainFqdn: body.domainFqdn,
          error: domainError instanceof Error ? domainError.message : String(domainError),
        });
      }
    }

    // Step 2: Call agents service to remove publish symlink
    // In V2 mode, use the app's agent_url; in local dev, use AGENTS_SERVICE_URL
    let agentsSuccess = false;
    let agentsError: { status?: number; message?: string } | null = null;
    try {
      const agentsBaseUrl = isV2 && site.agent_url
        ? site.agent_url
        : (process.env.AGENTS_SERVICE_URL || 'http://localhost:4000');
      const agentsUrl = `${agentsBaseUrl}/apps/${siteId}/unpublish`;

      logger.info('unpublish.api.agents.start', { siteId, agentsBaseUrl });

      // Create a token with canPublish permission for the agents service
      // This is needed because unpublish requires the same permission as publish
      const jwtService = getJWTService();
      const tokenResult = await jwtService.createToken({
        siteId,
        canDownload: true,
        canPublish: true,
        authType: user.authType || 'basic',
        isE2S: user.isE2S ?? false,
      });

      const agentsResponse = await fetch(agentsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenResult.token}`,
        },
      });

      if (agentsResponse.ok) {
        agentsSuccess = true;
        logger.info('unpublish.api.agents.success', { siteId });
      } else {
        const errorText = await agentsResponse.text();
        logger.error('unpublish.api.agents.failed', {
          siteId,
          status: agentsResponse.status,
          error: errorText,
        });
        agentsError = { status: agentsResponse.status, message: errorText };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('unpublish.api.agents.error', {
        siteId,
        error: errorMessage,
      });
      agentsError = { message: errorMessage };
    }

    // If agents unpublish failed, don't proceed with control plane update
    if (!agentsSuccess && agentsError) {
      return NextResponse.json(
        {
          error: 'Failed to unpublish app',
          details: agentsError.message,
          retryable: true,
        },
        { status: agentsError.status ?? 500 }
      );
    }

    // Step 3: Call control plane to mark publish variant as inactive (V2 only)
    if (isV2 && site.subscription_id && site.system_id) {
      try {
        const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
        const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });

        logger.info('unpublish.api.control_plane.start', {
          siteId,
          subscriptionId: site.subscription_id,
          systemId: site.system_id,
        });

        const result = await client.unpublishApp(
          site.subscription_id,
          site.system_id,
          siteId
        );

        logger.info('unpublish.api.control_plane.success', {
          siteId,
          message: result.message,
        });

        return NextResponse.json({
          success: true,
          message: result.message,
          agentsSuccess,
          domainJobId,
          domainDisconnectFailed,
        });
      } catch (cpError) {
        const status = (cpError as { status?: number })?.status;

        // 409 means no publish variant exists - app is already unpublished
        if (status === 409) {
          logger.info('unpublish.api.already_unpublished', { siteId });
          return NextResponse.json({
            success: true,
            message: 'App is already unpublished',
            agentsSuccess,
            domainJobId,
            domainDisconnectFailed,
          });
        }

        logger.error('unpublish.api.control_plane.error', {
          siteId,
          error: cpError instanceof Error ? cpError.message : String(cpError),
          status,
        });

        return NextResponse.json(
          {
            error: 'Failed to unpublish app in control plane',
            details: cpError instanceof Error ? cpError.message : String(cpError),
            retryable: true,
            agentsSuccess,
          },
          { status: status ?? 500 }
        );
      }
    }

    // Local dev / legacy mode - agents success is enough
    if (agentsSuccess) {
      return NextResponse.json({
        success: true,
        message: 'App unpublished',
      });
    }

    // If we get here, neither agents nor control plane succeeded
    return NextResponse.json(
      {
        error: 'Failed to unpublish app',
        retryable: true,
      },
      { status: 500 }
    );

  } catch (error) {
    logger.error('unpublish.api.error', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });

    const status = (error as { status?: number })?.status ?? 500;

    return NextResponse.json(
      {
        error: 'Failed to unpublish app',
        details: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
      { status }
    );
  }
});
