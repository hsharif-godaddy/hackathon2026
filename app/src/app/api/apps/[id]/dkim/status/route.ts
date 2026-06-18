import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DkimAgentClient } from '@/lib/dkim/dkim-agent-client';
import { getDkimStatusCached } from '@/lib/dkim/dkim-cache';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

function withPollingState<T extends Record<string, unknown>>(
  status: T,
  pollingState: {
    pollStartedAt?: string | null;
    nextPollAt?: string | null;
    lastPolledAt?: string | null;
    expired?: boolean;
  } | null,
): T & {
  pollStartedAt: string | null;
  nextPollAt?: string | null;
  lastPolledAt?: string | null;
  pollingExpired?: boolean;
} {
  if (!pollingState) {
    return {
      ...status,
      pollStartedAt: null,
    };
  }

  return {
    ...status,
    pollStartedAt: pollingState?.pollStartedAt ?? null,
    nextPollAt: pollingState?.nextPollAt ?? null,
    lastPolledAt: pollingState?.lastPolledAt ?? null,
    pollingExpired: pollingState?.expired ?? false,
  };
}

export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  const rawDomain = request.nextUrl.searchParams.get('domain');

  if (!rawDomain) {
    return NextResponse.json({ error: 'domain query param is required' }, { status: 400 });
  }
  const domain = rawDomain.toLowerCase();
  const externalPollingRequested = request.nextUrl.searchParams.get('polling') === 'external';

  // Verify the queried domain is actually attached to this app. Without
  // this, any authenticated caller can probe DKIM status for ANY domain
  // by passing it via ?domain=, exploiting the global (per-domain, not
  // per-app) cache to learn whether a competitor's domain has been
  // onboarded with us. Status data is mostly public (DKIM records are in
  // DNS), but the "is this domain attached to one of our customers"
  // signal isn't.
  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(appId, authContext.jwt!);
  if (!site) {
    return NextResponse.json({ code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' }, { status: 404 });
  }

  const attachedFqdns = (site.domains ?? []).map((d) => d.fqdn.toLowerCase());
  if (!attachedFqdns.includes(domain)) {
    logger.warn('dkim.status.domain.not-attached', { appId, domain });
    return NextResponse.json(
      { error: 'domain is not attached to this app' },
      { status: 403 },
    );
  }

  // Reconcile-on-read and durable external polling are gated by BOTH the
  // master flag and the durable-state flag. Flag lookups are best-effort here:
  // a Switchboard outage must NOT degrade the existing status endpoint.
  let reconcileEnabled = false;
  try {
    const [baseOn, durableOn] = await Promise.all([
      checkSwitchboardFlag('appbuilder-dkim-onboarding', request),
      checkSwitchboardFlag('appbuilder-dkim-durable-state', request),
    ]);
    reconcileEnabled = baseOn && durableOn;
  } catch (e) {
    logger.warn('dkim.status.flag-lookup.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
  }

  const dkimAgent = reconcileEnabled && site.agent_url
    ? new DkimAgentClient(site.agent_url, appId)
    : null;

  let pollingState: Awaited<ReturnType<DkimAgentClient['claimDuePoll']>> | null = null;
  if (dkimAgent && externalPollingRequested) {
    pollingState = await dkimAgent.claimDuePoll(domain).catch((e: unknown) => {
      logger.warn('dkim.status.poll.claim.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      return null;
    });

    // status === null means no row exists (onboard hasn't run yet for this domain).
    // Don't short-circuit in that case — still call getDkimStatusCached so the
    // UI gets actual DNS state while waiting for onboard to create the row.
    if (pollingState && !pollingState.shouldPoll && pollingState.status !== null && pollingState.status !== 'active') {
      return NextResponse.json(withPollingState({
        dkimValid: false,
        dkimResult: pollingState.expired ? 'DKIM_POLLING_EXPIRED' : 'DKIM_POLL_NOT_DUE',
      }, pollingState));
    }
  }

  try {
    const status = await getDkimStatusCached(domain);

    if (dkimAgent && pollingState?.shouldPoll && !status.dkimValid) {
      await dkimAgent.completeDuePoll(domain).catch((e: unknown) => {
        logger.warn('dkim.status.poll.complete.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
      const row = await dkimAgent.getRow(domain).catch((e: unknown) => {
        logger.warn('dkim.status.get-row.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
        return null;
      });
      pollingState = {
        ...pollingState,
        pollStartedAt: row?.pollStartedAt ?? pollingState.pollStartedAt,
        nextPollAt: row?.nextPollAt ?? pollingState.nextPollAt,
        lastPolledAt: row?.lastPolledAt ?? pollingState.lastPolledAt,
      };
    }

    if (dkimAgent && status.dkimValid) {
      void dkimAgent.markActive(domain).catch((e: unknown) => {
        logger.warn('dkim.status.reconcile.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
    }

    return NextResponse.json(withPollingState(status, pollingState));
  } catch (err) {
    logger.error('dkim.status.fetch.error', {
      appId,
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'DKIM status temporarily unavailable' }, { status: 503 });
  }
});
