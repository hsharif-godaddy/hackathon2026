import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DkimAgentClient } from '@/lib/dkim/dkim-agent-client';
import { getDkimStatusCached } from '@/lib/dkim/dkim-cache';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

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

  try {
    const status = await getDkimStatusCached(domain);

    // Reconcile-on-read: promote the durable row to active when DNS confirms
    // validity. Gated by BOTH the master flag and the durable-state flag.
    // Flag lookups are best-effort here: this status read had NO Switchboard
    // dependency before the durable layer, so a Switchboard outage must NOT
    // degrade it — swallow lookup errors and just skip the reconcile.
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

    if (reconcileEnabled && status.dkimValid && site.agent_url) {
      const dkimAgent = new DkimAgentClient(site.agent_url, appId);
      void dkimAgent.markActive(domain).catch((e: unknown) => {
        logger.warn('dkim.status.reconcile.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
    }

    return NextResponse.json(status);
  } catch (err) {
    logger.error('dkim.status.fetch.error', {
      appId,
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'DKIM status temporarily unavailable' }, { status: 503 });
  }
});
