import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { resolveAgentsBaseUrl } from '@/lib/agents-base-url';
import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { resolveMultiUserFlag } from '@/lib/authz-fga/multi-user-flag';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type SiteInfo } from '@/lib/control-plane/types';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getJWTService } from '@/lib/jwt-service';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { mgmtAiro401Response } from '@/lib/mgmt-airo/auth-error';
import { ServerPaywallProvider } from '@/lib/paywall/server-provider';
import { isProfessionalOrAbove } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { SubscriptionPlan } from '@/types/credits';

const MGMT_AIRO_BASE_URL = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

export const dynamic = 'force-dynamic';

function createClient(jwt: string) {
  return new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt });
}

/**
 * Best-effort unpublish after transfer initiation.
 * Calls agents to remove the publish symlink and mgmt-airo to mark variant inactive.
 * Failures are logged but do not block the transfer.
 */
async function unpublishAfterTransfer(
  site: SiteInfo,
  authContext: CustomerAuthContext
) {
  const { id } = site;
  const agentBaseUrl: string = resolveAgentsBaseUrl(site);

  try {
    const { user } = authContext;
    const tokenResult = await getJWTService().createToken({
      siteId: id,
      canDownload: false,
      canPublish: true,
      authType: user.authType || 'basic',
      isE2S: user.isE2S ?? false,
    });

    const response = await fetch(`${agentBaseUrl}/apps/${id}/unpublish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResult.token}`,
      },
    });

    if (response.ok) {
      logger.info('transfer.unpublish.agents.success', { appId: id });
    } else {
      let body: string | undefined;
      try { body = await response.text(); } catch { body = undefined; }
      logger.error('transfer.unpublish.agents.failed', { appId: id, status: response.status, body });
    }
  } catch (err) {
    logger.error('transfer.unpublish.agents.error', {
      appId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (site.subscription_id && site.system_id) {
    try {
      await createClient(authContext.jwt).unpublishApp(site.subscription_id, site.system_id, id);
      logger.info('transfer.unpublish.controlPlane.success', { appId: id });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 409) {
        logger.info('transfer.unpublish.alreadyUnpublished', { appId: id });
      } else {
        logger.error('transfer.unpublish.controlPlane.error', {
          appId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

// POST /api/apps/:id/transfer — Initiate transfer
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    let body: { targetEmail?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!body.targetEmail) {
      return NextResponse.json({ error: 'targetEmail is required' }, { status: 400 });
    }

    const paywallProvider = new ServerPaywallProvider(authContext.jwt, authContext.user.customerId, request.headers);
    const accountSubscription = await paywallProvider.getAccountSubscription();
    const currentPlan = accountSubscription?.plan ?? SubscriptionPlan.None;
    if (!isProfessionalOrAbove(currentPlan)) {
      logger.warn('transfer.initiate.planGate', { appId: id, plan: currentPlan });
      return NextResponse.json({ error: 'Transfer requires a Professional or Ultimate plan' }, { status: 403 });
    }

    const adapter = getControlPlaneAdapter();
    const multiUserEnabled = await resolveMultiUserFlag(request);
    const site = await adapter.getSite(id, authContext.jwt, undefined, { multiUserEnabled });

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const transferDeny = await enforceAabMultiUserVentureRelation({
      request,
      siteId: id,
      customerId: authContext.user.customerId,
      siteInfo: site,
      relation: AUTHZ_FGA_RELATIONS.canTransfer,
      forbiddenMessage: 'You do not have permission to transfer this app.',
    });
    if (transferDeny) {
      return transferDeny;
    }

    const agentBaseUrl: string = resolveAgentsBaseUrl(site);

    try {
      const validateResponse = await agentFetch(
        `${agentBaseUrl}/apps/${id}/commerce/binding`,
        { siteId: id }
      );
      if (validateResponse.ok) {
        const binding: { configured?: boolean } = await validateResponse.json();
        const gdCommerce: boolean = Boolean(binding.configured);
        if (gdCommerce) {
          logger.warn('transfer.initiate.blocked', { appId: id, gdCommerce });
          return NextResponse.json(
            { error: 'Transfer is unavailable for apps with GoDaddy Commerce integration' },
            { status: 403 }
          );
        }
      } else {
        logger.error('transfer.validate.preflight.failure', { appId: id, status: validateResponse.status });
        return NextResponse.json(
          { error: 'Unable to verify transfer eligibility' },
          { status: 503 }
        );
      }
    } catch (error) {
      logger.error('transfer.validate.preflight.error', {
        appId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Unable to verify transfer eligibility' },
        { status: 503 }
      );
    }

    const data = await createClient(authContext.jwt).initiateTransfer(id, body.targetEmail);
    logger.info('transfer.initiate.success', { appId: id, status: data.status });

    unpublishAfterTransfer(site, authContext).catch(function logUnpublishError(err) {
      logger.error('transfer.unpublish.unexpected', {
        appId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const authResponse = mgmtAiro401Response(error, 'transfer.initiate.hbi-expired', { appId: id });
    if (authResponse) return authResponse;

    if (error instanceof AiroHttpError) {
      logger.error('transfer.initiate.failed', { appId: id, status: error.status, error: error.body });
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.initiate.error', {
      appId: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to initiate transfer' }, { status: 500 });
  }
}, { level: 3 });

// GET /api/apps/:id/transfer — Get transfer metadata (initiator)
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const transferToken = new URL(request.url).searchParams.get('transferToken') || undefined;
    const data = await createClient(authContext.jwt).getTransferMetadata(id, transferToken);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AiroHttpError) {
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.metadata.error', {
      appId: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to get transfer metadata' }, { status: 500 });
  }
});

// DELETE /api/apps/:id/transfer — Cancel transfer
export const DELETE = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const adapter = getControlPlaneAdapter();
    const multiUserEnabled = await resolveMultiUserFlag(_request);
    const site = await adapter.getSite(id, authContext.jwt, undefined, { multiUserEnabled });
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const cancelTransferDeny = await enforceAabMultiUserVentureRelation({
      request: _request,
      siteId: id,
      customerId: authContext.user.customerId,
      siteInfo: site,
      relation: AUTHZ_FGA_RELATIONS.canTransfer,
      forbiddenMessage: 'You do not have permission to cancel a transfer for this app.',
    });
    if (cancelTransferDeny) {
      return cancelTransferDeny;
    }

    const data = await createClient(authContext.jwt).cancelTransfer(id);
    logger.info('transfer.cancel.success', { appId: id });
    return NextResponse.json(data);
  } catch (error) {
    const authResponse = mgmtAiro401Response(error, 'transfer.cancel.hbi-expired', { appId: id });
    if (authResponse) return authResponse;

    if (error instanceof AiroHttpError) {
      logger.error('transfer.cancel.failed', { appId: id, status: error.status, error: error.body });
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.cancel.error', {
      appId: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to cancel transfer' }, { status: 500 });
  }
});
