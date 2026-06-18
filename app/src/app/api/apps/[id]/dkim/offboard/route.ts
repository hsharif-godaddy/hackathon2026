import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DkimAgentClient } from '@/lib/dkim/dkim-agent-client';
import { DkimService } from '@/lib/dkim/dkim-service';
import { DkimErrorCode } from '@/lib/dkim/types';
import { AiroHttpError } from '@/lib/mgmt-airo';
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
  const rawDomain = body.domain;

  if (!rawDomain || typeof rawDomain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }
  const domain = rawDomain.toLowerCase();

  // Early flag check — see onboard/route.ts for rationale. Short-circuits
  // before getSite to avoid wasted upstream load when the feature is off.
  // DkimService.deactivate also enforces this gate (defense-in-depth).
  const flagOn = await checkSwitchboardFlag('appbuilder-dkim-onboarding', request);
  if (!flagOn) {
    logger.info('dkim.offboard.skipped.feature_flag_off', { appId, domain });
    return NextResponse.json({ result: 'skipped', reason: 'feature_flag_off' });
  }

  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt!);
    if (!site) {
      return NextResponse.json({ code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' }, { status: 404 });
    }

    logger.info('dkim.offboard.trigger', { appId, domain });
    const service = new DkimService();
    const outcome = await service.deactivate({
      appId,
      domain,
      shopperId: authContext.user.shopperId,
    }, request);

    const durableEnabled = await checkSwitchboardFlag('appbuilder-dkim-durable-state', request);
    if (durableEnabled) {
      // Tear down the durable onboarding row so a future re-attach can re-onboard.
      // Best-effort: never fail the offboard response on a teardown error.
      if (site.agent_url) {
        const dkimAgent = new DkimAgentClient(site.agent_url, appId);
        try {
          await dkimAgent.deleteRow(domain);
        } catch (e) {
          logger.error('dkim.offboard.deleteRow.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
          // Retry with a conditional delete targeting only the active row.
          // setFailed is not used here because the repository enforces
          // status != 'active' on that update, making it a silent no-op for
          // the exact case we need to recover from.
          await dkimAgent.deleteRow(domain, { ifStatus: 'active' }).catch((e2: unknown) => {
            logger.error('dkim.offboard.deleteRow.fallback-failed', { appId, domain, error: e2 instanceof Error ? e2.message : String(e2) });
          });
        }
      }
    }

    return NextResponse.json(outcome);
  } catch (err) {
    const isAiro = err instanceof AiroHttpError;
    const status = isAiro ? err.status : 500;
    logger.error('dkim.offboard.error', {
      appId,
      domain,
      error: err instanceof Error ? err.message : String(err),
      errorBody: isAiro ? JSON.stringify(err) : undefined,
    });
    return NextResponse.json(
      {
        code: DkimErrorCode.OFFBOARD_FAILED,
        error: 'DKIM offboarding failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status },
    );
  }
}, { level: 3 });
