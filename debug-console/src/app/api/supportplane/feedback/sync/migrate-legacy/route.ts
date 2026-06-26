import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getSpEnv } from '@/lib/supportplane/store/config';
import { getFeedbackStore } from '@/lib/supportplane/store/feedback-store';

export const POST = withAuth(async (req: NextRequest) => {
  const env: string = req.nextUrl.searchParams.get('env') ?? getSpEnv();

  try {
    logger.info('supportplane.feedback.migrate-legacy.start', { env });

    const result = await getFeedbackStore().migrateLegacyToRawTables(env);

    logger.info('supportplane.feedback.migrate-legacy.done', {
      env,
      legacyTotal: result.legacyTotal,
      s3Written: result.s3Written,
      athenaWritten: result.athenaWritten,
      enrichedTotal: result.enrichedTotal,
    });

    return NextResponse.json({ success: true, env, ...result });
  } catch (err) {
    const msg: string = err instanceof Error ? err.message : String(err);
    logger.error('supportplane.feedback.migrate-legacy.error', { env, error: msg });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
});
