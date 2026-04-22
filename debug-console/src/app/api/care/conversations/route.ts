import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import {
    DEFAULT_CARE_LOOKBACK_MINUTES,
    MAX_CARE_LOOKBACK_MINUTES,
} from '@/lib/care-types';
import { extractCookieValue } from '@/lib/cookies';
import { logger } from '@/lib/logger';
import { SHOPPER_ID_RE } from '@/lib/mgmt-helpers';
import { CARE_BASE_URL } from '@/lib/upstream-hosts';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function listShopperConversations(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const shopperId = searchParams.get('shopperId') || '';
    const lastMinutes = searchParams.get('lastMinutes') || String(DEFAULT_CARE_LOOKBACK_MINUTES);

    if (!shopperId || !SHOPPER_ID_RE.test(shopperId)) {
        return NextResponse.json({ error: 'Invalid or missing shopperId' }, { status: 400 });
    }
    if (!/^\d{1,7}$/.test(lastMinutes)) {
        return NextResponse.json({ error: 'Invalid lastMinutes' }, { status: 400 });
    }
    const lastMinutesNum = parseInt(lastMinutes, 10);
    if (lastMinutesNum < 1 || lastMinutesNum > MAX_CARE_LOOKBACK_MINUTES) {
        return NextResponse.json(
            {
                error: `lastMinutes must be between 1 and ${MAX_CARE_LOOKBACK_MINUTES}`,
            },
            { status: 400 }
        );
    }

    const upstream = `${CARE_BASE_URL}/conversation-state/shopper/${encodeURIComponent(
        shopperId
    )}/conversations?lastMinutes=${encodeURIComponent(lastMinutes)}`;

    // Care rejects the `Authorization: sso-jwt <jwt>` header that other
    // GoDaddy APIs (e.g. shopper) accept — verified by reproducing a 401
    // from this route while the same call against care's own UI works
    // when it sends cookies. Forward the cookie jar verbatim instead.
    const cookieHeader = request.headers.get('cookie') || '';
    if (!extractCookieValue(cookieHeader, 'auth_jomax')) {
        return NextResponse.json(
            { error: 'Missing auth_jomax cookie' },
            { status: 401 }
        );
    }

    try {
        const res = await fetch(upstream, {
            headers: {
                accept: 'application/json',
                cookie: cookieHeader,
            },
            cache: 'no-store',
        });

        const text = await res.text();
        if (!res.ok) {
            logger.warn('care.conversations.upstream.error', {
                status: res.status,
                shopperId,
                lastMinutes,
            });
            return NextResponse.json(
                { error: 'Upstream error', status: res.status, body: safeJson(text) },
                { status: res.status }
            );
        }

        return new NextResponse(text, {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    } catch (error) {
        logger.error(
            'care.conversations.fetch.error',
            { shopperId, lastMinutes },
            { error: error as Error }
        );
        return NextResponse.json(
            { error: 'Failed to fetch conversations', message: (error as Error).message },
            { status: 502 }
        );
    }
});

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
