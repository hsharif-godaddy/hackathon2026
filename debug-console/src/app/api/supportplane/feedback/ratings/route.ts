import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getRatingDistribution, getCategoryBreakdown } from '@/lib/supportplane/db/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const appId = req.nextUrl.searchParams.get('app_id') ?? undefined;
        const ratings = await getRatingDistribution(env, appId);
        const categories = await getCategoryBreakdown(env);
        return NextResponse.json({ ratings, categories });
    } catch (error) {
        logger.error('supportplane.feedback.ratings.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get rating data' }, { status: 500 });
    }
});
