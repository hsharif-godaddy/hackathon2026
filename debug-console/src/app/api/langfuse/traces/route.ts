import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getLangfuseConfig } from '@/lib/langfuse-client';
import { logger } from '@/lib/logger';

export const GET = withAuth(async (request, _auth) => {
  const requestStartedAt = Date.now();
  try {
    const lf = getLangfuseConfig();
    if (!lf) {
      logger.error('langfuse.traces.config.missing');
      return NextResponse.json(
        { error: 'Langfuse credentials not configured' },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '50';
    const sessionId = searchParams.get('sessionId');
    const fromTimestamp = searchParams.get('fromTimestamp');
    const appId = searchParams.get('appId');
    logger.info('langfuse.traces.request.start', {
      page,
      limit,
      hasSessionId: !!sessionId,
      hasFromTimestamp: !!fromTimestamp,
      hasAppId: !!appId,
    });

    const params = new URLSearchParams({ page, limit });
    if (sessionId) {
      params.append('sessionId', sessionId);
    }
    if (fromTimestamp) {
      params.append('fromTimestamp', fromTimestamp);
    }
    // See: https://api.reference.langfuse.com/#tag/trace/GET/api/public/traces
    if (appId) {
      params.append('userId', appId);
    }

    const response = await fetch(`${lf.baseUrl}/api/public/traces?${params}`, {
      headers: {
        'Authorization': lf.authHeader,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('langfuse.traces.request.error', {
        page,
        limit,
        status: response.status,
        message: errorText.slice(0, 200),
      }, {
        duration: Date.now() - requestStartedAt,
      });
      return NextResponse.json(
        { error: `Langfuse API error: ${response.status}`, message: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    logger.info('langfuse.traces.request.success', {
      page,
      limit,
      returnedItems: Array.isArray(data?.data) ? data.data.length : 0,
      totalPages: data?.meta?.totalPages || null,
    }, {
      duration: Date.now() - requestStartedAt,
    });
    return NextResponse.json(data);
  } catch (error) {
    logger.error('langfuse.traces.request.failure', undefined, {
      error: error as Error,
      duration: Date.now() - requestStartedAt,
    });
    return NextResponse.json(
      { error: 'Failed to fetch Langfuse traces', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
