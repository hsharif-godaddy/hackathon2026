import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';

const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL;
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

export const GET = withAuth<{ traceId: string }>(async (request, auth, context) => {
  try {
    if (!LANGFUSE_BASE_URL || !LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Langfuse credentials not configured' },
        { status: 500 }
      );
    }

    const { traceId } = await context.params;

    const authHeader = `Basic ${Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString('base64')}`;

    const response = await fetch(`${LANGFUSE_BASE_URL}/api/public/traces/${traceId}`, {
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
    console.error('Langfuse trace fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Langfuse trace' },
      { status: 500 }
    );
  }
});
