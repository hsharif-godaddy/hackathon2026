import { NextRequest, NextResponse } from 'next/server';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const GET = withAuth<{ appId: string; conversationId: string }>(async function getConversation(_request: NextRequest, _auth, context) {
    const { appId, conversationId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }
    if (!CONVERSATION_ID_RE.test(conversationId)) {
        return NextResponse.json({ error: 'Invalid conversationId' }, { status: 400 });
    }

    try {
        const { status, body } = await fetchAgentJson({
            appId,
            path: `/agent/conversations/${encodeURIComponent(appId)}/${encodeURIComponent(conversationId)}`,
        });
        return NextResponse.json(body, { status });
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.conversations.get.error', { appId, conversationId }, { error: error as Error });
        return NextResponse.json(
            { error: 'Failed to fetch conversation' },
            { status: 502 }
        );
    }
});
