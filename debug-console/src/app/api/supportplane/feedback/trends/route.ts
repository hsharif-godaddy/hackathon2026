import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getFeedbackTrends } from '@/lib/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const granularity = (req.nextUrl.searchParams.get('granularity') ?? 'day') as 'day' | 'week' | 'month';
        const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);
        const trends = getFeedbackTrends(env, granularity, days);
        return NextResponse.json({ trends, granularity, days });
    } catch (error) {
        logger.error('supportplane.feedback.trends.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get trends' }, { status: 500 });
    }
});
