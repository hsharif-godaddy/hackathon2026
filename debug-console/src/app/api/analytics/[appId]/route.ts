import { NextResponse } from 'next/server';

import { getAppDetails, init } from '@/lib/analytics/es-db';
import { withAuth } from '@/lib/api-auth';

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export const GET = withAuth<{ appId: string }>(async (request, auth, context) => {
  await ensureInitialized();

  try {
    const { appId } = await context.params;
    const details = await getAppDetails(appId);
    return NextResponse.json(details);
  } catch (error) {
    console.error('Analytics app details error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch app details', details: String(error) },
      { status: 500 }
    );
  }
});
