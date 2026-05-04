import { NextRequest, NextResponse } from 'next/server';

import { DEBUG_CONSOLE_ALLOWED_GROUPS } from '@/lib/ad-groups';
import { fetchUserAdGroups, intersectGroupsCaseInsensitive } from '@/lib/api-auth';
import { gdAuthService } from '@/lib/gd-auth-service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Returns whether the caller is a member of any AD group that is allowed
 * to access the debug console. Used by ProtectedRoute to render an
 * Access Denied page for signed-in users who lack the required groups.
 *
 * Response (200):
 *   { allowed: boolean; matchedGroups: string[]; user: { email, ... } }
 *
 * 401 if the caller is not authenticated.
 */
export async function GET(request: NextRequest) {
    const token = gdAuthService.extractTokenFromRequest(request);
    if (!token) {
        return NextResponse.json({ error: 'Unauthorized', reason: 'No authentication token' }, { status: 401 });
    }

    const auth = await gdAuthService.authenticate(token, request);
    if (!auth.valid) {
        return NextResponse.json({ error: 'Unauthorized', reason: auth.reason ?? 'Authentication failed' }, { status: 401 });
    }

    const fetched = await fetchUserAdGroups(request, token);
    if (!fetched.ok) {
        logger.warn('api-auth.membership.fetch.failed', { status: fetched.status, reason: fetched.reason });
        return NextResponse.json(
            { error: fetched.status === 401 ? 'Unauthorized' : 'Forbidden', reason: fetched.reason },
            { status: fetched.status }
        );
    }

    const matchedGroups = intersectGroupsCaseInsensitive(fetched.groups, DEBUG_CONSOLE_ALLOWED_GROUPS);

    return NextResponse.json({
        allowed: matchedGroups.length > 0,
        matchedGroups,
        allowedGroups: DEBUG_CONSOLE_ALLOWED_GROUPS,
        user: {
            email: auth.payload?.email,
            shopperId: auth.payload?.shopperId,
            cid: auth.payload?.cid,
        },
    });
}
