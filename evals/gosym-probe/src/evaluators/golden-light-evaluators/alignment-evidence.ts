import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import {
  buildConversationText,
  summarizeToolCalls,
  lastSnapshotSectionSanitized,
  truncate,
} from '../shared.js';

const MAX_PERSONA_CHARS = 3_000;

export async function buildAlignmentEvidence(
  transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
): Promise<string> {
  const toolCalls = transcript.turns.flatMap((t) => t.toolCalls);
  const conversation = buildConversationText(transcript.turns);
  const tools = summarizeToolCalls(toolCalls);
  const finalSite = await lastSnapshotSectionSanitized(snapshot);
  const totalToolCalls = toolCalls.length;

  return [
    `SCENARIO: ${scenario.name}`,
    `GOALS: ${scenario.goals.map((g) => g.description).join('; ') || '(none)'}`,
    '',
    'PERSONA_SYSTEM_PROMPT:',
    truncate(scenario.persona.systemPrompt ?? '', MAX_PERSONA_CHARS) || '(none)',
    '',
    '---',
    'CONVERSATION:',
    conversation || '(none)',
    '',
    'TOOL_CALLS (summarized):',
    tools,
    '',
    'FINAL_SITE (last snapshot):',
    finalSite,
    '---',
    '',
    `META: totalToolCalls=${totalToolCalls} transcriptErrors=${transcript.errors.length}`,
  ].join('\n');
}
