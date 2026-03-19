import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, validateId, handleMgmtError } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const POST = withAuth<{ appId: string }>(async function reloadApp(
    request: NextRequest,
    _auth,
    context
) {
    const { appId } = await context.params;

    let subscriptionId: string | undefined;
    let systemId: string | undefined;

    try {
        const body = await request.json();
        subscriptionId = body.subscriptionId || undefined;
        systemId = body.systemId || undefined;
    } catch { /* empty body is fine */ }

    const invalid =
        validateId(appId, 'appId', APP_ID_RE) ??
        (subscriptionId ? validateId(subscriptionId, 'subscriptionId', APP_ID_RE) : null) ??
        (systemId ? validateId(systemId, 'systemId', APP_ID_RE) : null);
    if (invalid) {return invalid;}

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.reloadApp(appId, { subscriptionId, systemId }));
    } catch (error) {
        return handleMgmtError(error, 'trigger app reload', { appId });
    }
});
