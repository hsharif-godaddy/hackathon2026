import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { SUBSCRIPTION_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ subscriptionId: string }>(async function getSubscription(
    _request: NextRequest,
    _auth,
    context
) {
    const { subscriptionId } = await context.params;

    const invalid = validateId(subscriptionId, 'subscriptionId', SUBSCRIPTION_ID_RE);
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getSubscription(subscriptionId));
    } catch (error) {
        return handleMgmtError(error, 'fetch subscription', { subscriptionId });
    }
});
