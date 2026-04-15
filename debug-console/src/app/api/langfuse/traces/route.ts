import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getLangfuseConfig } from '@/lib/langfuse-client';

export const GET = withAuth(async (request, _auth) => {
  try {
    const lf = getLangfuseConfig();
    if (!lf) {
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
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Langfuse API error: ${response.status}`, message: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Langfuse traces fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Langfuse traces', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
