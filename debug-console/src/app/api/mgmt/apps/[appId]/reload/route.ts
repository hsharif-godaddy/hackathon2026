import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import mgmtControlPlaneAdapter, { MgmtControlPlaneError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9]{8,20}$/i;

function validateId(value: string, name: string): NextResponse | null {
    if (!ID_RE.test(value)) {
        return NextResponse.json({ error: `Invalid ${name}` }, { status: 400 });
    }
    return null;
}

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
        validateId(appId, 'appId') ??
        (subscriptionId ? validateId(subscriptionId, 'subscriptionId') : null) ??
        (systemId ? validateId(systemId, 'systemId') : null);
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.reloadApp(appId, { subscriptionId, systemId }));
    } catch (error) {
        if (error instanceof MgmtControlPlaneError) {
            return NextResponse.json(
                { error: error.message, details: error.responseJson ?? error.responseBody },
                { status: error.statusCode }
            );
        }

        console.error('[mgmt-apps] reloadApp failed', {
            appId,
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Failed to trigger app reload' }, { status: 502 });
    }
});
