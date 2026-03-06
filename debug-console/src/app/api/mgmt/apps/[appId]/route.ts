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

export const GET = withAuth<{ appId: string }>(async function getAppDetails(
    _request: NextRequest,
    _auth,
    context
) {
    const { appId } = await context.params;

    const invalid = validateId(appId, 'appId');
    if (invalid) return invalid;

    try {
        return NextResponse.json(await mgmtControlPlaneAdapter.getAppDetails(appId));
    } catch (error) {
        if (error instanceof MgmtControlPlaneError) {
            return NextResponse.json(
                { error: error.message, details: error.responseJson ?? error.responseBody },
                { status: error.statusCode }
            );
        }

        console.error('[mgmt-apps] getAppDetails failed', {
            appId,
            error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json({ error: 'Failed to fetch app details' }, { status: 502 });
    }
});
