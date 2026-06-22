import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getTranscriptById } from '@/lib/l1-transcript-db';
import { logger } from '@/lib/logger';

async function handler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing id param' }, { status: 400 });
  }

  try {
    const transcript = await getTranscriptById(id);
    if (!transcript) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ transcript });
  } catch (error) {
    logger.error('supportplane.transcripts.detail.error', { id, error: String(error) });
    return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
  }
}

export const GET = withAuth(handler);
