import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';

const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL;
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

export const GET = withAuth(async (request) => {
  try {
    if (!LANGFUSE_BASE_URL || !LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
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

    const params = new URLSearchParams({ page, limit });
    if (sessionId) {
      params.append('sessionId', sessionId);
    }
    if (fromTimestamp) {
      params.append('fromTimestamp', fromTimestamp);
    }

    const authHeader = `Basic ${Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString('base64')}`;

    const response = await fetch(`${LANGFUSE_BASE_URL}/api/public/traces?${params}`, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Langfuse API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Langfuse traces fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Langfuse traces' },
      { status: 500 }
    );
  }
});
