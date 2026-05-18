import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getSummaryById } from '@/lib/investigate/summaries';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth<{ id: string }>(async (_request, _auth, context) => {
  const { id } = await (context as RouteContext).params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  let summary;
  try {
    summary = await getSummaryById(id);
  } catch (err) {
    logger.error('investigate.summaries.get.failed', { id }, { error: err as Error });
    return NextResponse.json({ error: 'get_failed' }, { status: 503 });
  }
  if (!summary) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(summary);
});
