/**
 * l1-transcript-ai-tagging.ts
 * AI-powered tagging using GoCode for L1 transcripts
 */

import { callGoCode, isGoCodeConfigured } from './gocode-client';

/**
 * Extract intent tags from transcript using GoCode
 */
export async function extractTagsFromTranscript(
  transcript: string,
  summary?: string
): Promise<string[]> {
  if (!isGoCodeConfigured()) {
    console.warn('GoCode not configured. Skipping AI tagging.');
    return [];
  }

  // Truncate transcript if too long (max 8000 chars for prompt)
  const truncatedTranscript = transcript.substring(0, 8000);
  const summaryText = summary ? `\n\nSummary: ${summary}` : '';

  const prompt = `Analyze this Airo App Builder customer support transcript and extract 3-7 tags describing the customer's PAIN POINTS and FRICTION they experienced while building their site.

Focus on:
- What problems or frustrations the customer encountered
- What wasn't working or was confusing
- Where they got stuck or needed help
- Specific friction points in their experience

Tags should be:
- Lowercase, underscore-separated words (e.g., "publish_failure", "responsiveness_not_working")
- Specific and actionable (describe the actual problem, not just the topic)
- Examples for Airo App Builder: "publish_failure", "responsiveness_not_working", "ai_generation_failed", "preview_mismatch", "site_went_down", "slow_loading", "editing_broken", "image_upload_failed", "domain_connection_failed", "template_layout_broken", "mobile_view_broken", "content_disappeared", "unable_to_save", "incorrect_billing", "feature_missing", "unclear_error_message"

Transcript:
${truncatedTranscript}${summaryText}

Return ONLY a valid JSON array of tags, nothing else. Example: ["publish_failure", "responsiveness_not_working", "ai_generation_failed"]`;

  try {
    const response = await callGoCode({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
      timeout_ms: 15000,
    });

    const content = response.choices?.[0]?.message?.content || '';

    // Parse JSON array from response
    const jsonMatch = content.match(/\[.*\]/s);
    if (jsonMatch) {
      const tags = JSON.parse(jsonMatch[0]);
      if (Array.isArray(tags)) {
        return tags.map((t: any) => String(t).toLowerCase().trim()).filter(Boolean);
      }
    }

    console.warn('Failed to parse tags from GoCode response:', content);
    return [];
  } catch (error) {
    console.error('AI tagging error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Process transcripts in batches and add AI tags
 */
export async function tagTranscriptsBatch(
  transcripts: Array<{ interaction_id: string; full_transcript: string; conversation_summary?: string }>,
  updateFn: (interactionId: string, tags: string[]) => void
): Promise<{ tagged: number; failed: number }> {
  const BATCH_SIZE = 5; // Process 5 at a time to avoid rate limits
  const DELAY_MS = 1000; // 1 second delay between batches

  let tagged = 0;
  let failed = 0;

  for (let i = 0; i < transcripts.length; i += BATCH_SIZE) {
    const batch = transcripts.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (t) => {
        const tags = await extractTagsFromTranscript(t.full_transcript, t.conversation_summary);
        updateFn(t.interaction_id, tags);
        return tags;
      })
    );

    // Count successes/failures
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        tagged++;
      } else {
        failed++;
      }
    });

    // Progress log
    console.log(`Tagged ${Math.min(i + BATCH_SIZE, transcripts.length)}/${transcripts.length} transcripts`);

    // Delay between batches (except for last batch)
    if (i + BATCH_SIZE < transcripts.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  return { tagged, failed };
}
