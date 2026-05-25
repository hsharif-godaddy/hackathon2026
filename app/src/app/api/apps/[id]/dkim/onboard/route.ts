import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DkimService } from '@/lib/dkim/dkim-service';
import { deriveDomainOrigin, DomainOrigin } from '@/lib/dkim/utils';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const domain = body.domain;

  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  // Early flag check — short-circuit before any upstream calls
  // (getSite, getDomainDnsOwnership). DkimService also enforces this
  // gate as defense-in-depth, but checking here saves the round-trips
  // to mgmt-hosting + mgmt-airo when the feature is off across a
  // partial-rollout customer base. The pre-existing
  // /api/sites/[id]/domain-dns-ownership route (used for DNS-instruction
  // flows independent of DKIM) is NOT affected — it stays callable for
  // every authenticated request as before.
  const flagOn = await checkSwitchboardFlag('appbuilder-dkim-onboarding', request);
  if (!flagOn) {
    logger.info('dkim.onboard.skipped.feature_flag_off', { appId, domain });
    return NextResponse.json({ result: 'skipped', reason: 'feature_flag_off' });
  }

  // Wrap upstream calls — adapter.getSite and mgmtClient.getDomainDnsOwnership
  // can throw on network/auth errors. Match the structured-logging pattern
  // used by sites/[id]/domain-dns-ownership/route.ts so failures are
  // observable with appId/domain context instead of leaking generic 500s.
  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt!);
    if (!site) {
      return NextResponse.json({ code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' }, { status: 404 });
    }
    if (!site.subscription_id || !site.system_id) {
      return NextResponse.json({ code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site config incomplete' }, { status: 400 });
    }

    const mgmtClient = new AiroMgmtClient({
      baseUrl: process.env.MGMT_AIRO_BASE_URL ?? 'https://mgmt.nstk.net',
      jwt: authContext.jwt!,
    });
    const ownership = await mgmtClient.getDomainDnsOwnership(
      site.subscription_id,
      site.system_id,
      appId,
      { fqdns: domain, customerId: authContext.user.customerId, shopperId: authContext.user.shopperId },
    );

    const origin = deriveDomainOrigin(ownership);
    if (origin !== DomainOrigin.INTERNAL) {
      logger.info('dkim.auto-onboard.trigger.skipped', { appId, domain, isGoDaddyDns: ownership.isGoDaddyDns });
      return NextResponse.json({ result: 'skipped', reason: 'not_internal' });
    }

    logger.info('dkim.auto-onboard.trigger', { appId, domain, isGoDaddyDns: ownership.isGoDaddyDns });
    const service = new DkimService();
    const outcome = await service.activate({
      appId,
      domain,
      shopperId: authContext.user.shopperId,
      origin,
    }, request);

    return NextResponse.json(outcome);
  } catch (err) {
    logger.error('dkim.onboard.error', {
      appId,
      domain,
      error: err instanceof Error ? err.message : String(err),
      errorBody: err instanceof AiroHttpError ? JSON.stringify(err) : undefined,
    });
    return NextResponse.json(
      {
        code: ApiErrorCode.SITE_NOT_FOUND, // closest existing code; refine if a DKIM-specific code is added
        error: 'DKIM onboarding failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: err instanceof AiroHttpError ? err.status : 500 },
    );
  }
}, { level: 3 });
