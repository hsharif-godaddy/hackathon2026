import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter, { MgmtControlPlaneError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9]{4,30}$/i;

export const GET = withAuth<{ subscriptionId: string }>(async function getSubscription(
    _request: NextRequest,
    _auth,
    context
) {
    const { subscriptionId } = await context.params;

    if (!ID_RE.test(subscriptionId)) {
        return NextResponse.json({ error: 'Invalid subscriptionId' }, { status: 400 });
    }

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getSubscription(subscriptionId));
    } catch (error) {
        if (error instanceof MgmtControlPlaneError) {
            return NextResponse.json(
                { error: error.message, details: error.responseJson ?? error.responseBody },
                { status: error.statusCode }
            );
        }
        console.error('[mgmt-subscriptions] getSubscription failed', {
            subscriptionId,
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 502 });
    }
});
