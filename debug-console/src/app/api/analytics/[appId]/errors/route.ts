import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getAppErrors } from '@/lib/analytics/es-db';

export const GET = withAuth<{ appId: string }>(async (request, _auth, context) => {
  try {
    const { appId } = await context.params;
    const fromTimestamp = request.nextUrl.searchParams.get('fromTimestamp') || undefined;
    const errors = await getAppErrors(appId, fromTimestamp);
    return NextResponse.json(errors);
  } catch (error) {
    console.error('Analytics app errors fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch app errors', details: String(error) },
      { status: 500 }
    );
  }
});
