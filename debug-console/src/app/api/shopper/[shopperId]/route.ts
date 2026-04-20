import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { extractCookieValue } from '@/lib/cookies';
import { logger } from '@/lib/logger';
import { SHOPPER_ID_RE } from '@/lib/mgmt-helpers';
import { SHOPPER_BASE_URL } from '@/lib/upstream-hosts';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ shopperId: string }>(async function getShopper(
    request: NextRequest,
    _auth,
    context
) {
    const { shopperId } = await context.params;
    if (!shopperId || !SHOPPER_ID_RE.test(shopperId)) {
        return NextResponse.json({ error: 'Invalid shopperId' }, { status: 400 });
    }

    // Honest audit logging: use the first hop in X-Forwarded-For when present,
    // falling back to X-Real-IP, then localhost. The upstream Shopper API
    // requires this param for audit attribution.
    const auditClientIp = clientIpFromRequest(request);

    const upstream = `${SHOPPER_BASE_URL}/v1/shoppers/${encodeURIComponent(
        shopperId
    )}?auditClientIp=${encodeURIComponent(auditClientIp)}`;

    const jomax = extractCookieValue(request.headers.get('cookie'), 'auth_jomax');

    logger.info('shopper.lookup.request', {
        shopperId,
        hasJomax: !!jomax,
    });

    if (!jomax) {
        return NextResponse.json(
            { error: 'Missing auth_jomax cookie' },
            { status: 401 }
        );
    }

    try {
        const res = await fetch(upstream, {
            headers: {
                accept: 'application/json',
                authorization: `sso-jwt ${jomax}`,
            },
            cache: 'no-store',
        });

        const text = await res.text();
        if (!res.ok) {
            logger.warn('shopper.lookup.upstream.error', {
                status: res.status,
                shopperId,
                hasJomax: !!jomax,
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
        logger.error('shopper.lookup.fetch.error', { shopperId }, { error: error as Error });
        return NextResponse.json(
            { error: 'Failed to fetch shopper', message: (error as Error).message },
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

function clientIpFromRequest(request: NextRequest): string {
    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
    }
    return request.headers.get('x-real-ip')?.trim() || '127.0.0.1';
}
