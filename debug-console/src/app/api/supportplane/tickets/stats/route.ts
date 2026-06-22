import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getTicketStats } from '@/lib/support-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supportplane/tickets/stats
 *
 * Returns aggregated statistics from support.db
 */
export const GET = withAuth(async function ticketsStats(_request: NextRequest) {
  try {
    const stats = await getTicketStats();

    return NextResponse.json(stats);
  } catch (err) {
    logger.error('supportplane.tickets.stats.error', {}, { error: err as Error });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
});
