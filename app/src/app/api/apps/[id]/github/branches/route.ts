import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext,withCustomerAuth } from '@/lib/customer-auth';
import { enforce, proxy, resolveToken } from '@/lib/github';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const gateResponse = await enforce(request);
  if (gateResponse) return gateResponse;

  const { id: appId } = await params;
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo');

  if (!repo) {
    return NextResponse.json({ error: 'repo is required (owner/name format)' }, { status: 400 });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: 'repo must be owner/name format' }, { status: 400 });
  }

  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const token = await resolveToken(appId, authContext.jwt);

    const res = await proxy(`/repos/${repo}/branches`, token, {
      params: { per_page: '100' },
    });

    if (!res.ok) {
      logger.warn('github.branches.upstream-error', { appId, repo, status: res.status });
      return NextResponse.json({ error: 'Failed to fetch branches' }, { status: res.status });
    }

    const branches = await res.json();
    return NextResponse.json(
      branches.map((b: Record<string, unknown>) => ({
        name: b.name,
        protected: b.protected,
      })),
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (err) {
    logger.error('github.branches.failed', {
      appId,
      repo,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Not connected to GitHub' }, { status: 401 });
  }
});
