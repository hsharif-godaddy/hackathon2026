import { NextRequest, NextResponse } from 'next/server';

import { OPS_ADMIN } from '@/lib/ad-groups';
import { CREDIT_PACK_OPTIONS, CREDITS_MAX } from '@/lib/credit-pack-utils';
import { withAuth } from '@/lib/api-auth';
import { computeUseBefore } from '@/lib/date-utils';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, handleMgmtError, SUBSCRIPTION_ID_RE, validateId } from '@/lib/mgmt-helpers';

export const GET = withAuth<{ appId: string, subscriptionId: string }>(async function eligibility(
    _request: NextRequest,
    auth,
    context
) {
    const { appId, subscriptionId } = await context.params;

    const invalid = validateId(appId, 'appId', APP_ID_RE) ?? validateId(subscriptionId, 'subscriptionId', SUBSCRIPTION_ID_RE);
    if (invalid) return invalid;

    try {
        const appDetails = await mgmtControlPlaneAdapter.getAppDetails(appId, { includeResources: false });
        if (appDetails.subscriptionId !== subscriptionId) {
            return NextResponse.json({ error: 'Invalid subscription ID' }, { status: 400 });
        }
    } catch (error) {
        return handleMgmtError(error, 'fetch app details', { appId, subscriptionId, shopperId: auth.user?.shopperId });
    }

    logger.info('credit-pack.eligibility.success', {
        appId,
        subscriptionId,
        shopperId: auth.user?.shopperId
    });

    return NextResponse.json({
        type: 'credit-pack',
        creditsMax: CREDITS_MAX,
        creditPackOptions: CREDIT_PACK_OPTIONS,
        useBefore: computeUseBefore(),
    });
}, { adGroup: OPS_ADMIN });
