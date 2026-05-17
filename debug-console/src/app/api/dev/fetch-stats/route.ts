import { NextResponse } from 'next/server';

import { getDevFetchStats } from '@/lib/dev-fetch-instrumentation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Snapshot of outbound-fetch counts collected by `dev-fetch-instrumentation`.
 * Only useful when the dev server was started with `DEBUG_FETCH=1`; otherwise
 * the counters stay at zero. No auth — dev-only diagnostic.
 */
export async function GET(): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'dev-only endpoint' }, { status: 404 });
  }
  const stats = getDevFetchStats();
  const memory = process.memoryUsage();
  return NextResponse.json({
    ...stats,
    heap: {
      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
      rssMB: Math.round(memory.rss / 1024 / 1024),
      externalMB: Math.round(memory.external / 1024 / 1024),
    },
    enabled: process.env.DEBUG_FETCH === '1',
  });
}
