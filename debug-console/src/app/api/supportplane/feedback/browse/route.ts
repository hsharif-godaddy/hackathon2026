import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getRecentFeedback } from '@/lib/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const { searchParams } = req.nextUrl;
        const env = searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const limit = parseInt(searchParams.get('limit') ?? '50', 10);
        const offset = parseInt(searchParams.get('offset') ?? '0', 10);
        const filters = {
            category: searchParams.get('category') ?? undefined,
            rating: searchParams.get('rating') ? parseInt(searchParams.get('rating')!, 10) : undefined,
            appId: searchParams.get('app_id') ?? undefined,
            days: searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : undefined,
        };
        const sortCol = searchParams.get('sort') ?? undefined;
        const sortDir = (searchParams.get('order') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
        const sort = sortCol ? { col: sortCol, dir: sortDir } : undefined;

        const { rows, total } = await getRecentFeedback(env, limit, offset, filters, sort);
        return NextResponse.json({
            rows, total,
            pagination: { limit, offset, has_more: total > offset + rows.length },
        });
    } catch (error) {
        logger.error('supportplane.feedback.browse.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to browse feedback' }, { status: 500 });
    }
});
