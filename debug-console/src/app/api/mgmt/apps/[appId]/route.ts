import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ appId: string }>(async function getAppDetails(
    _request: NextRequest,
    _auth,
    context
) {
    const { appId } = await context.params;

    const invalid = validateId(appId, 'appId', APP_ID_RE);
    if (invalid) {return invalid;}

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getAppDetails(appId));
    } catch (error) {
        return handleMgmtError(error, 'fetch app details', { appId });
    }
});
