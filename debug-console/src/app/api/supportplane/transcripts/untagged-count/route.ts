/**
 * /api/supportplane/transcripts/untagged-count
 * Get count of transcripts without tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';

async function handler(request: NextRequest) {
  try {
    const db = getL1TranscriptsDb();

    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM l1_transcripts
      WHERE tags IS NULL
        AND full_transcript IS NOT NULL
        AND full_transcript != ''
    `).get() as { count: number };

    return NextResponse.json({
      success: true,
      untagged: result.count,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to count untagged transcripts',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
