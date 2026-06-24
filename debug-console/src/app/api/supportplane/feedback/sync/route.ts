import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getFeedbackIngestionStatus, getDataCoverage, getIngestionLog } from '@/lib/supportplane/db/feedback-db';
import type { IngestionStatus, DataCoverage, IngestionLogEntry } from '@/lib/supportplane/db/feedback-db';
import { getSpEnv } from '@/lib/supportplane/store/config';

export const POST = withAuth(async (req: NextRequest) => {
    try {
        const force: boolean = req.nextUrl.searchParams.get('force') === 'true';
        const { runFeedbackIngestion } = await import('@/lib/supportplane/ingest/feedback-ingest');

        logger.info('supportplane.feedback.sync.start', { force });
        const result: { newRows: number; errors: number } = await runFeedbackIngestion(undefined, { force });
        logger.info('supportplane.feedback.sync.done', { newRows: result.newRows, errors: result.errors });

        return NextResponse.json({ success: true, result });
    } catch (error) {
        const msg: string = error instanceof Error ? error.message : String(error);
        logger.error('supportplane.feedback.sync.error', { error: msg });
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
});

export const GET = withAuth(async (req: NextRequest) => {
    const env: string = req.nextUrl.searchParams.get('env') ?? getSpEnv();

    const [statusResult, coverageResult, logResult] = await Promise.all([
        getFeedbackIngestionStatus().then((v: IngestionStatus) => ({ ok: true as const, value: v })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
        getDataCoverage(env).then((v: DataCoverage) => ({ ok: true as const, value: v })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
        getIngestionLog(100).then((v: IngestionLogEntry[]) => ({ ok: true as const, value: v })).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    ]);

    if (!statusResult.ok) logger.warn('supportplane.feedback.status.error', { error: statusResult.error });
    if (!coverageResult.ok) logger.warn('supportplane.feedback.coverage.error', { error: coverageResult.error });
    if (!logResult.ok) logger.warn('supportplane.feedback.log.error', { error: logResult.error });

    const defaultStatus: IngestionStatus = { totalFiles: 0, successFiles: 0, errorFiles: 0, lastSync: null, totalRows: 0, dbPath: '' };
    const defaultCoverage: DataCoverage = { earliest: null, latest: null, totalRows: 0, monthsCovered: [], athenaRows: 0, s3OnlyRows: 0, bothRows: 0 };

    return NextResponse.json({
        status: statusResult.ok ? statusResult.value : defaultStatus,
        coverage: coverageResult.ok ? coverageResult.value : defaultCoverage,
        log: logResult.ok ? logResult.value : [],
        errors: {
            ...(statusResult.ok ? {} : { status: statusResult.error }),
            ...(coverageResult.ok ? {} : { coverage: coverageResult.error }),
            ...(logResult.ok ? {} : { log: logResult.error }),
        },
    });
});
