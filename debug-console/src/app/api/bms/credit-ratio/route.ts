/**
 * GET /api/bms/credit-ratio?appId=<id>
 *
 * Returns the app's BMS cost-to-credit ratio so credits can be derived from USD
 * cost. Thin wrapper over resolveCreditRatio (shared with the EB sessions route,
 * which stamps credits onto each trace). Always HTTP 200 with
 * { useBms, ratio, mixedRatios }; non-BMS/failure → { useBms: false, ratio: null }.
 */

import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { NOT_BMS_RATIO, resolveCreditRatio } from '@/lib/bms-credit-ratio';
import { APP_ID_RE } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request: NextRequest) => {
    const appId = request.nextUrl.searchParams.get('appId');
    if (!appId) {
        return NextResponse.json({ error: 'appId is required' }, { status: 400 });
    }
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }
    if (request.signal.aborted) return NextResponse.json(NOT_BMS_RATIO);
    return NextResponse.json(await resolveCreditRatio(appId, request));
});
