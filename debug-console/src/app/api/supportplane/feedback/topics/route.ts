import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getTopicFrequency, getAppLeaderboard } from '@/lib/supportplane/db/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const topN = parseInt(req.nextUrl.searchParams.get('top') ?? '20', 10);
        const topics = await getTopicFrequency(env, topN);
        const apps = await getAppLeaderboard(env, 15);
        return NextResponse.json({ topics, apps });
    } catch (error) {
        logger.error('supportplane.feedback.topics.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get topics' }, { status: 500 });
    }
});
