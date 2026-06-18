import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getFeedbackSummary, getFeedbackIngestionStatus } from '@/lib/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const days = req.nextUrl.searchParams.get('days');
        const summary = getFeedbackSummary(env, days ? parseInt(days, 10) : undefined);
        const status = getFeedbackIngestionStatus();
        return NextResponse.json({ summary, ingestion: status });
    } catch (error) {
        logger.error('supportplane.feedback.summary.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get feedback summary' }, { status: 500 });
    }
});
