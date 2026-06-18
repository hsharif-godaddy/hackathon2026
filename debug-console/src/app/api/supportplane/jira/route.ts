import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { fetchProjectTickets, isJiraConfigured } from '@/lib/jira-client';

const BOARD_PROJECTS: Record<string, string> = {
    ciec:  'CIEC',
    aabsp: 'AABSP',
};

export const GET = withAuth(async (req: NextRequest) => {
    const board = req.nextUrl.searchParams.get('board') ?? 'ciec';
    const projectKey = BOARD_PROJECTS[board];

    if (!projectKey) {
        return NextResponse.json({ error: `Unknown board: ${board}` }, { status: 400 });
    }

    if (!isJiraConfigured()) {
        return NextResponse.json({
            configured: false,
            message: 'Set JIRA_CLIENT_ID + JIRA_CLIENT_SECRET + JIRA_CLOUD_ID in Katana secrets (prod) or .env.local (dev)',
            tickets: [],
        });
    }

    try {
        const tickets = await fetchProjectTickets(projectKey);
        return NextResponse.json({ configured: true, board, projectKey, tickets });
    } catch (err) {
        logger.error('supportplane.jira.route.error', { board, error: String(err) });
        return NextResponse.json(
            { configured: true, error: 'Failed to fetch Jira tickets', detail: String(err), tickets: [] },
            { status: 502 },
        );
    }
});
