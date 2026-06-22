import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const POST = withAuth(async (req: NextRequest) => {
    try {
        const force = req.nextUrl.searchParams.get('force') === 'true';

        // Import dynamically so the heavy AWS SDK only loads when actually syncing
        const { runFeedbackIngestion } = await import('@/lib/feedback-ingest');

        logger.info('supportplane.feedback.sync.start', { force });
        const result = await runFeedbackIngestion(undefined, { force });
        logger.info('supportplane.feedback.sync.done', { newRows: result.newRows, errors: result.errors });

        return NextResponse.json({ success: true, result });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error('supportplane.feedback.sync.error', { error: msg });
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
});

export const GET = withAuth(async (req: NextRequest) => {
    const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
    const { getFeedbackIngestionStatus, getDataCoverage, getIngestionLog } = await import('@/lib/feedback-db');
    const [status, coverage, log] = await Promise.all([
        getFeedbackIngestionStatus(),
        getDataCoverage(env),
        getIngestionLog(100),
    ]);
    return NextResponse.json({ status, coverage, log });
});
