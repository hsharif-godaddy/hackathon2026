import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';

export {
  clamp01,
  truncate,
  extractBodyHtml,
  htmlToText,
  buildConversationText,
  summarizeToolCalls,
  lastSnapshotSection,
  lastSnapshotSectionSanitized,
} from '../shared.js';

import { buildConversationText, summarizeToolCalls, lastSnapshotSectionSanitized } from '../shared.js';

export async function buildEvidence(
  transcript: Transcript,
  snapshot?: DOMSnapshot,
): Promise<{
  conversation: string;
  tools: string;
  finalSite: string;
  totalToolCalls: number;
}> {
  const toolCalls = transcript.turns.flatMap((turn) => turn.toolCalls);
  return {
    conversation: buildConversationText(transcript.turns),
    tools: summarizeToolCalls(toolCalls),
    finalSite: await lastSnapshotSectionSanitized(snapshot),
    totalToolCalls: toolCalls.length,
  };
}
