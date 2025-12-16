import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';

/**
 * POST /api/referral/track - Track referral link clicks
 *
 * Logs referral click events server-side where info-level logging is captured.
 * Called by the client-side ReferralTracker component.
 *
 * @param request - The incoming Next.js request with referralId and path
 * @returns NextResponse with success status
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { referralId, path } = body;

    if (!referralId) {
      return NextResponse.json(
        { error: 'Missing referralId' },
        { status: 400 }
      );
    }

    logger.info('referral.click', {
      referralId,
      path: path || '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('referral.track.error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to track referral' },
      { status: 500 }
    );
  }
}
