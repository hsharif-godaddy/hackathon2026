import { NextRequest, NextResponse } from 'next/server';

import { fetchAgentWithJomax } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { gdAuthService } from '@/lib/gd-auth-service';
import { logger } from '@/lib/logger';
import { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MEMORY_TIMEOUT_MS = 8000;

export const GET = withAuth<{ appId: string }>(async function getMemory(request: NextRequest, _auth, context) {
    const { appId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }

    const jomaxToken = gdAuthService.extractTokenFromRequest(request);
    if (!jomaxToken) {
        return NextResponse.json({ error: 'Missing operator token' }, { status: 401 });
    }

    try {
        const { status, body } = await fetchAgentWithJomax({
            appId,
            path: '/diagnostics/memory',
            jomaxToken,
            timeoutMs: MEMORY_TIMEOUT_MS,
        });
        return NextResponse.json(body, { status });
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        const aborted = (error as Error)?.name === 'AbortError';
        logger.error('agent.diagnostics.memory.error', { appId, aborted }, { error: error as Error });
        return NextResponse.json(
            { error: aborted ? 'Memory diagnostics timed out' : 'Memory diagnostics failed' },
            { status: aborted ? 504 : 502 }
        );
    }
});
