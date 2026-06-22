import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { listTickets } from '@/lib/support-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supportplane/tickets/browse
 *
 * Browse and filter support tickets from support.db
 */
export const GET = withAuth(async function ticketsBrowse(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const filters = {
      status: searchParams.get('status') ?? undefined,
      priority: searchParams.get('priority') ?? undefined,
      assignee: searchParams.get('assignee') ?? undefined,
      project: searchParams.get('project') ?? undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 50,
      offset: searchParams.get('offset') ? Number(searchParams.get('offset')) : 0,
    };

    const tickets = await listTickets(filters);

    return NextResponse.json({
      tickets,
      count: tickets.length,
      filters,
    });
  } catch (err) {
    logger.error('supportplane.tickets.browse.error', {}, { error: err as Error });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
        tickets: [],
        count: 0,
      },
      { status: 500 }
    );
  }
});
