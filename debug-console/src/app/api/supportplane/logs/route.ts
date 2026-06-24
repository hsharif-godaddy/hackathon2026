import { type NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { clearLogs, getActiveMask, getLogs, setActiveMask } from '@/lib/supportplane/sp-logger';

export const dynamic = 'force-dynamic';

// GET /api/supportplane/logs
// Query params:
//   mask   — bitmask filter applied to returned entries (default 127 = All)
//   search — substring filter on message and source
//   since  — minutes of history (0 = all, default 0)
//   limit  — max entries returned (max 500, default 200)
//   offset — pagination offset (default 0)
export const GET = withAuth(async (req: NextRequest) => {
  const sp: URLSearchParams = req.nextUrl.searchParams;
  const maskParam: string = sp.get('mask') ?? '127';
  const mask: number = Math.max(0, Math.min(127, parseInt(maskParam, 10) || 127));
  const search: string = sp.get('search') ?? '';
  const sinceMin: number = parseInt(sp.get('since') ?? '0', 10) || 0;
  const limit: number = Math.min(500, parseInt(sp.get('limit') ?? '200', 10) || 200);
  const offset: number = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
  const since: number | undefined = sinceMin > 0 ? Date.now() - sinceMin * 60_000 : undefined;

  const result = getLogs({ levelMask: mask, search: search || undefined, since, limit, offset });
  return NextResponse.json({ ...result, activeMask: getActiveMask() });
});

// PATCH /api/supportplane/logs — update the runtime log mask
// Body: { mask: number }
export const PATCH = withAuth(async (req: NextRequest) => {
  const body = await req.json() as Record<string, unknown>;
  if (typeof body['mask'] === 'number') {
    setActiveMask(body['mask']);
  }
  return NextResponse.json({ activeMask: getActiveMask() });
});

// DELETE /api/supportplane/logs — clear the ring buffer
export const DELETE = withAuth(async () => {
  clearLogs();
  return NextResponse.json({ cleared: true, activeMask: getActiveMask() });
});
