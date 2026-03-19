import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ appId: string }>(async function getImageStatus(
    request: NextRequest,
    _auth,
    context
) {
    const { appId } = await context.params;
    const subscriptionId = request.nextUrl.searchParams.get('subscriptionId') || undefined;
    const systemId = request.nextUrl.searchParams.get('systemId') || undefined;
    const tryCount = Number(request.nextUrl.searchParams.get('tryCount') ?? 0);

    const invalid =
        validateId(appId, 'appId', APP_ID_RE) ??
        (subscriptionId ? validateId(subscriptionId, 'subscriptionId', APP_ID_RE) : null) ??
        (systemId ? validateId(systemId, 'systemId', APP_ID_RE) : null);
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getImageStatus(appId, { subscriptionId, systemId, tryCount }));
    } catch (error) {
        return handleMgmtError(error, 'fetch image status', { appId });
    }
});
