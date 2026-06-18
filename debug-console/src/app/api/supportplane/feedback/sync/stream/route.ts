import { type NextRequest } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest) => {
    const force = req.nextUrl.searchParams.get('force') === 'true';
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: object) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* client disconnected */ }
            };

            try {
                const { runFeedbackIngestion } = await import('@/lib/feedback-ingest');
                logger.info('supportplane.feedback.sync.stream.start', { force });

                await runFeedbackIngestion((progress) => {
                    send(progress);
                }, { force });
                // runFeedbackIngestion already emits a complete done event; nothing extra needed.
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error('supportplane.feedback.sync.stream.error', { error: msg });
                send({ phase: 'error', message: msg });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
});
