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
        validateId(appId, 'appId') ??
        (subscriptionId ? validateId(subscriptionId, 'subscriptionId') : null) ??
        (systemId ? validateId(systemId, 'systemId') : null);
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getImageStatus(appId, { subscriptionId, systemId, tryCount }));
    } catch (error) {
        if (error instanceof MgmtControlPlaneError) {
            return NextResponse.json(
                { error: error.message, details: error.responseJson ?? error.responseBody },
                { status: error.statusCode }
            );
        }

        console.error('[mgmt-apps] getImageStatus failed', {
            appId,
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Failed to fetch image status' }, { status: 502 });
    }
});
