import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { runRebuildComposite } from '@/lib/feedback-ingest';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async () => {
    try {
        logger.info('supportplane.feedback.rebuild.start', {});
        const result = await runRebuildComposite();
        logger.info('supportplane.feedback.rebuild.done', result);
        return Response.json({ ok: true, ...result });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('supportplane.feedback.rebuild.error', { error: msg });
        return Response.json({ ok: false, error: msg }, { status: 500 });
    }
});
