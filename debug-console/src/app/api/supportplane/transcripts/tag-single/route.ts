/**
 * Tag a single transcript with AI-generated tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTranscriptById, updateTranscriptTags } from '@/lib/supportplane/db/l1-transcript-db';
import { extractTagsFromTranscript } from '@/lib/l1-transcript-ai-tagging';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { interaction_id } = body;

    if (!interaction_id || typeof interaction_id !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid interaction_id' },
        { status: 400 }
      );
    }

    // Get the transcript
    const transcript = (await getTranscriptById(interaction_id)) as any;
    if (!transcript) {
      return NextResponse.json(
        { error: 'Transcript not found' },
        { status: 404 }
      );
    }

    // Extract tags using AI
    const tags = await extractTagsFromTranscript(
      transcript.full_transcript,
      transcript.conversation_summary
    );

    // Update in database
    await updateTranscriptTags(interaction_id, tags);

    logger.info('supportplane.l1_transcript.tag_single.done', {
      interaction_id,
      tags_count: tags.length,
      tags,
    });

    return NextResponse.json({
      success: true,
      interaction_id,
      tags,
      message: `Generated ${tags.length} tags`,
    });
  } catch (error) {
    logger.error('supportplane.l1_transcript.tag_single.failed', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Failed to tag transcript',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
