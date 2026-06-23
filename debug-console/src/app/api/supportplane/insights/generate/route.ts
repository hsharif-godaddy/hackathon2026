import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { generateBugInsights } from '@/lib/insights/generate-bugs';
import { generateFeatureInsights } from '@/lib/insights/generate-features';
import { generateFrictionPatterns } from '@/lib/insights/generate-patterns';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

/**
 * POST /api/supportplane/insights/generate
 * Trigger background insights generation
 */
async function handler(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const days: number = body.days || 30;

    logger.info('insights.generation.triggered', { days });

    // Trigger background job (don't block response)
    Promise.all([
      generateBugInsights(days),
      generateFeatureInsights(days),
      generateFrictionPatterns(days),
    ])
      .then(() => {
        logger.info('insights.generation.completed', { days });
      })
      .catch((err: Error) => {
        logger.error('insights.generation.failed', {
          error: err.message,
          stack: err.stack,
        });
      });

    return NextResponse.json({
      status: 'processing',
      estimated_time_sec: 120,
      days,
    });
  } catch (error) {
    logger.error('insights.generation.request.failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to trigger insights generation' },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler);
