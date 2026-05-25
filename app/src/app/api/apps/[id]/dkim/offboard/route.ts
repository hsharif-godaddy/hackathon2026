import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DkimService } from '@/lib/dkim/dkim-service';
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
  const domain = body.domain;

  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

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

    return NextResponse.json(outcome);
  } catch (err) {
    logger.error('dkim.offboard.error', {
      appId,
      domain,
      error: err instanceof Error ? err.message : String(err),
      errorBody: err instanceof AiroHttpError ? JSON.stringify(err) : undefined,
    });
    return NextResponse.json(
      {
        code: ApiErrorCode.SITE_NOT_FOUND,
        error: 'DKIM offboarding failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: err instanceof AiroHttpError ? err.status : 500 },
    );
  }
}, { level: 3 });
