import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getWoWComparison, getMoMComparison } from '@/lib/feedback-db';

export const GET = withAuth(async (req: NextRequest) => {
    try {
        const env = req.nextUrl.searchParams.get('env') ?? (process.env.FEEDBACK_ENV ?? 'dev');
        const [wow, mom] = await Promise.all([getWoWComparison(env), getMoMComparison(env)]);
        return NextResponse.json({ wow, mom });
    } catch (error) {
        logger.error('supportplane.feedback.comparison.error', { error: String(error) });
        return NextResponse.json({ error: 'Failed to get comparison data' }, { status: 500 });
    }
});
