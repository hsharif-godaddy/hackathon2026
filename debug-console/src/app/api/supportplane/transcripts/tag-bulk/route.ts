/**
 * /api/supportplane/transcripts/tag-bulk
 * Bulk AI tagging for transcripts without tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getUntaggedTranscripts, updateTranscriptTags } from '@/lib/supportplane/db/l1-transcript-db';
import { tagTranscriptsBatch } from '@/lib/l1-transcript-ai-tagging';
import { isGoCodeConfigured } from '@/lib/gocode-client';

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'POST') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Check if GoCode is configured
    if (!isGoCodeConfigured()) {
      return NextResponse.json({
        error: 'GoCode not configured',
        message: 'OPENAI_API_KEY is required for AI tagging'
      }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const batchSize = parseInt(searchParams.get('batch_size') || '50', 10);

    logger.info('supportplane.transcripts.tag_bulk.start', { batch_size: batchSize });

    const untagged = await getUntaggedTranscripts(batchSize);

    if (untagged.length === 0) {
      logger.info('supportplane.transcripts.tag_bulk.no_work', {});
      return NextResponse.json({
        success: true,
        message: 'No untagged transcripts found',
        tagged: 0,
        total: 0,
        status: 'completed',
      });
    }

    logger.info('supportplane.transcripts.tag_bulk.processing', {
      untagged_count: untagged.length
    });

    // Start tagging in background (fire and forget)
    // This allows the response to return immediately
    processTaggingInBackground(untagged, batchSize);

    // Return immediately - tagging continues in background
    return NextResponse.json({
      success: true,
      message: `Started tagging ${untagged.length} transcripts in background (batch size: ${batchSize})`,
      total: untagged.length,
      status: 'processing',
    });

  } catch (error) {
    logger.error('supportplane.transcripts.tag_bulk.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Tagging failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Process tagging in background
 * Runs async without blocking the API response
 */
async function processTaggingInBackground(
  untagged: Array<{
    interaction_id: string;
    full_transcript: string;
    conversation_summary: string | null;
  }>,
  batchSize: number
): Promise<void> {
  // Don't await - let this run in background
  (async () => {
    try {
      const result = await tagTranscriptsBatch(
        untagged.map(t => ({
          interaction_id: t.interaction_id,
          full_transcript: t.full_transcript,
          conversation_summary: t.conversation_summary || undefined,
        })),
        async function update(interactionId: string, tags: string[]) {
          await updateTranscriptTags(interactionId, tags);
        }
      );

      logger.info('supportplane.transcripts.tag_bulk.complete', {
        tagged: result.tagged,
        failed: result.failed,
        total: untagged.length,
      });
    } catch (error) {
      logger.error('supportplane.transcripts.tag_bulk.background_error', {}, { error: error as Error });
    }
  })();
}

export const POST = withAuth(handler);
