import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { extractCookieValue } from '@/lib/cookies';
import { logger } from '@/lib/logger';
import { CARE_BASE_URL } from '@/lib/upstream-hosts';

export const dynamic = 'force-dynamic';

const CONTACT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const GET = withAuth<{ contactId: string }>(async function getTranscript(
    request: NextRequest,
    _auth,
    context
) {
    const { contactId } = await context.params;
    const { searchParams } = new URL(request.url);
    const includeSurveyResponses = searchParams.get('includeSurveyResponses') ?? 'true';

    if (!contactId || !CONTACT_ID_RE.test(contactId)) {
        return NextResponse.json({ error: 'Invalid contactId' }, { status: 400 });
    }
    if (includeSurveyResponses !== 'true' && includeSurveyResponses !== 'false') {
        return NextResponse.json(
            { error: 'Invalid includeSurveyResponses (must be "true" or "false")' },
            { status: 400 }
        );
    }

    const upstream = `${CARE_BASE_URL}/transcripts/${encodeURIComponent(
        contactId
    )}?includeSurveyResponses=${encodeURIComponent(includeSurveyResponses)}`;

    const jomax = extractCookieValue(request.headers.get('cookie'), 'auth_jomax');
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
            logger.warn('care.transcript.upstream.error', { status: res.status, contactId });
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
        logger.error('care.transcript.fetch.error', { contactId }, { error: error as Error });
        return NextResponse.json(
            { error: 'Failed to fetch transcript', message: (error as Error).message },
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
