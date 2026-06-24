import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getFeedbackSummary, getFeedbackIngestionStatus, getDataCoverage } from '@/lib/supportplane/db/feedback-db';
import { getSpEnv } from '@/lib/supportplane/store/config';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? getSpEnv();
        const days = req.nextUrl.searchParams.get('days');
        const [summary, status, coverage] = await Promise.all([
            getFeedbackSummary(env, days ? parseInt(days, 10) : undefined),
            getFeedbackIngestionStatus(),
            getDataCoverage(env),
        ]);
        return NextResponse.json({ summary, ingestion: status, coverage });
    } catch (error) {
        logger.error('supportplane.feedback.summary.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get feedback summary' }, { status: 500 });
    }
});
