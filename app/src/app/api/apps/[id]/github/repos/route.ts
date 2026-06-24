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

  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const token = await resolveToken(appId, authContext.jwt);
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') ?? '1';
    const perPage = searchParams.get('per_page') ?? '30';

    const res = await proxy('/user/repos', token, {
      params: {
        sort: 'updated',
        direction: 'desc',
        per_page: perPage,
        page,
        type: 'owner',
      },
    });

    if (!res.ok) {
      logger.warn('github.repos.upstream-error', { appId, status: res.status });
      return NextResponse.json({ error: 'Failed to fetch repos' }, { status: res.status });
    }

    const repos = await res.json();
    return NextResponse.json(
      repos.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        htmlUrl: r.html_url,
        updatedAt: r.updated_at,
      })),
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (err) {
    logger.error('github.repos.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Not connected to GitHub' }, { status: 401 });
  }
});
