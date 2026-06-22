import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getFeedbackHeatmap } from '@/lib/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const type = (req.nextUrl.searchParams.get('type') ?? 'hour-of-day') as 'hour-of-day' | 'day-of-week';
        const heatmap = await getFeedbackHeatmap(env, type);
        return NextResponse.json({ heatmap, type });
    } catch (error) {
        logger.error('supportplane.feedback.heatmap.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get heatmap data' }, { status: 500 });
    }
});
