import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import type { RouteContext } from '@/lib/api-auth';
import { resolveAppCluster } from '@/lib/investigate/evidence';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/cluster/[appId] → { cluster: string | null }
 *
 * Thin wrapper around `resolveAppCluster` so the Logs tab's LogQL viewer can
 * render the actual `cluster="<id>"` label instead of a placeholder. The
 * server already memoizes the lookup, so multiple callers per appId share
 * the cost.
 */
export const GET = withAuth<{ appId: string }>(async (_request, _auth, context: RouteContext<{ appId: string }>) => {
  const { appId } = await context.params;
  if (!appId) {
    return NextResponse.json({ error: 'appId is required' }, { status: 400 });
  }
  try {
    const cluster = await resolveAppCluster(appId);
    return NextResponse.json(
      { cluster },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    );
  } catch (error) {
    console.error('[cluster] resolveAppCluster failed:', error);
    return NextResponse.json(
      { cluster: null, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 200 },
    );
  }
});
