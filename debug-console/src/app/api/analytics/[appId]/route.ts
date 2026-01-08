import { NextResponse } from 'next/server';

import { getAppDetails, init } from '@/lib/analytics/es-db';

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  await ensureInitialized();

  try {
    const { appId } = await params;
    const details = await getAppDetails(appId);
    return NextResponse.json(details);
  } catch (error) {
    console.error('Analytics app details error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch app details', details: String(error) },
      { status: 500 }
    );
  }
}

