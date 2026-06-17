import { NextRequest, NextResponse } from 'next/server';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const METADATA_TIMEOUT_MS = 8000;

export const GET = withAuth<{ appId: string }>(async function getMetadata(_request: NextRequest, _auth, context) {
    const { appId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }

    try {
        const { status, body } = await fetchAgentJson({
            appId,
            path: `/apps/${appId}/metadata`,
            timeoutMs: METADATA_TIMEOUT_MS,
        });
        return NextResponse.json(body, { status });
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        const aborted = (error as Error)?.name === 'AbortError';
        logger.error('agent.metadata.error', { appId, aborted }, { error: error as Error });
        return NextResponse.json(
            { error: aborted ? 'Metadata fetch timed out' : 'Metadata fetch failed' },
            { status: aborted ? 504 : 502 }
        );
    }
});
