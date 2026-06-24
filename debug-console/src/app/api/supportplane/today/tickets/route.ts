import { type NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { listTickets, type Ticket } from '@/lib/supportplane/db/support-db';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function todayTickets(_request: NextRequest) {
  const today: string = new Date().toISOString().split('T')[0]!;
  const resolved: Set<string> = new Set(['Done', 'Closed']);

  try {
    const tickets: Ticket[] = await listTickets({ limit: 5000 });
    const openCount: number = tickets.filter((t) => !resolved.has(t.status ?? '')).length;
    const resolvedToday: number = tickets.filter((t) => t.resolved_utc?.slice(0, 10) === today).length;
    const p1Count: number = tickets.filter((t) => t.priority === 'P1' && !resolved.has(t.status ?? '')).length;
    const createdToday: number = tickets.filter((t) => t.created_utc?.slice(0, 10) === today).length;
    return NextResponse.json({
      open: openCount,
      resolved_today: resolvedToday,
      p1_count: p1Count,
      backlog_velocity: createdToday - resolvedToday,
    });
  } catch (err) {
    const error: string = err instanceof Error ? err.message : String(err);
    logger.warn('supportplane.today.tickets.error', { error });
    return NextResponse.json({ open: 0, resolved_today: 0, p1_count: 0, backlog_velocity: 0, error });
  }
});
