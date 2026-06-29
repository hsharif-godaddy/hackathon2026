import { z } from 'zod';

import { LLMJudgeEvaluator } from './llm-judge-evaluator.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type { Transcript } from '../runner/transcript.js';
import type { Scenario, SkillInstruction } from '../scenarios/types.js';
import {
  reduceChecklistOutcomes,
  type ChecklistItemOutcome,
} from './checklist-verdict.js';
import type { ChecklistCheckType } from '../scenarios/types.js';
import { safeStringify, truncate } from './shared.js';

const MAX_TRANSCRIPT_CHARS = 6000;

const SkillOutcomeItemSchema = z.object({
  id: z.string(),
  followed: z.boolean(),
  reason: z.string(),
});

const SkillOutcomeSchema = z.object({
  items: z.array(SkillOutcomeItemSchema),
});

type SkillOutcomeResult = z.infer<typeof SkillOutcomeSchema>;

const SYSTEM_INSTRUCTIONS = [
  'You are a strict QA reviewer. You are given a set of SKILL INSTRUCTIONS',
  'that the agent was expected to follow, and EVIDENCE from the agent session',
  '(conversation transcript and tool calls).',
  '',
  'Judge ONLY whether each instruction was followed by the agent. Do not',
  'assess overall quality or anything outside the listed instructions.',
  'An instruction counts as followed if the evidence shows any valid',
  'implementation of it.',
  '',
  'Return JSON only, no prose, in exactly this shape:',
  '{ "items": [ { "id": "<instruction-id>", "followed": true|false,',
  '  "reason": "<short justification>" } ] }',
  'Include one entry per instruction, using the given ids.',
].join('\n');

function priorityToCheckType(priority: SkillInstruction['priority']): ChecklistCheckType {
  switch (priority) {
    case 'required':
      return 'capability';
    case 'advisory':
      return 'directional';
    default: {
      const exhaustive: never = priority;
      return exhaustive;
    }
  }
}

function instructionsBlock(instructions: SkillInstruction[]): string {
  return instructions
    .map((i) => `- id=${i.id} [${i.priority}]: ${i.instruction}`)
    .join('\n');
}

function transcriptBlock(transcript: Transcript): string {
  const text = transcript.turns
    .filter((t) => (t.content ?? '').trim().length > 0)
    .map((t) => `${t.role.toUpperCase()}: ${(t.content ?? '').trim()}`)
    .join('\n');
  return truncate(text, MAX_TRANSCRIPT_CHARS) || '(empty transcript)';
}

const MAX_TOOL_INPUT_CHARS = 600;

function toolCallsBlock(transcript: Transcript): string {
  const allToolCalls = transcript.turns.flatMap((t) => t.toolCalls);
  if (allToolCalls.length === 0) return '(no tool calls)';
  return truncate(
    allToolCalls
      .map((tc) => `- ${tc.name} input=${truncate(safeStringify(tc.input), MAX_TOOL_INPUT_CHARS)}`)
      .join('\n'),
    MAX_TRANSCRIPT_CHARS,
  );
}

function renderedBlock(transcript: Transcript): string {
  const site = transcript.capturedSite;
  if (!site) return '(no rendered content captured)';
  const text = site.perRoute
    .map((rc) => {
      const r = rc.rendered;
      if (!r) return '';
      return `${rc.route.path}: ${r.title} | ${r.h1 ?? ''} | ${r.bodyPreview}`;
    })
    .filter(Boolean)
    .join('\n');
  return text || '(no rendered content captured)';
}

function buildPrompt(
  transcript: Transcript,
  scenario: Scenario,
): string {
  const instructions = scenario.skillInstructions ?? [];
  return [
    SYSTEM_INSTRUCTIONS,
    '',
    'SKILL INSTRUCTIONS:',
    instructionsBlock(instructions),
    '',
    'EVIDENCE -- conversation transcript:',
    transcriptBlock(transcript),
    '',
    'EVIDENCE -- tool calls:',
    toolCallsBlock(transcript),
    '',
    'EVIDENCE -- rendered content:',
    renderedBlock(transcript),
  ].join('\n');
}

function toOutcomes(
  parsed: SkillOutcomeResult,
  instructions: SkillInstruction[],
): ChecklistItemOutcome[] {
  const byId = new Map(parsed.items.map((p) => [p.id, p]));
  return instructions.map((instr): ChecklistItemOutcome => {
    const judged = byId.get(instr.id);
    if (!judged) {
      return {
        id: instr.id,
        type: priorityToCheckType(instr.priority),
        status: 'unknown',
        reason: 'judge did not return a verdict for this instruction',
      };
    }
    return {
      id: instr.id,
      type: priorityToCheckType(instr.priority),
      status: judged.followed ? 'pass' : 'fail',
      reason: judged.reason,
    };
  });
}

/**
 * LLM-judge evaluator that checks whether the agent followed specific
 * skill instructions. Uses the shared checklist reducer for verdict
 * reduction: required instructions map to 'capability' (hard-fail),
 * advisory instructions map to 'directional' (soft partial).
 *
 * Returns 'unknown' when the scenario has no skillInstructions (non-skill-eval
 * scenarios). Inherits LLMJudgeEvaluator's 429-retry + parse/schema → 'unknown'
 * handling.
 */
export function createSkillOutcomeEvaluator(
  gocode: IGocodeClient,
): LLMJudgeEvaluator<SkillOutcomeResult> {
  return new LLMJudgeEvaluator<SkillOutcomeResult>(gocode, {
    name: 'skill-outcome',
    schema: SkillOutcomeSchema,
    canEvaluate: (_transcript, scenario) =>
      (scenario.skillInstructions?.length ?? 0) > 0,
    prompt: (transcript, scenario) => buildPrompt(transcript, scenario),
    toEvalResult: (parsed, _transcript, scenario) => {
      const instructions = scenario.skillInstructions ?? [];
      const outcomes = toOutcomes(parsed, instructions);
      const reduced = reduceChecklistOutcomes(outcomes);
      return {
        evaluator: 'skill-outcome',
        score: reduced.score,
        verdict: reduced.verdict,
        reason: reduced.reason,
        details: {
          items: outcomes,
          passedCount: reduced.passedCount,
          failedCount: reduced.failedCount,
          unknownCount: reduced.unknownCount,
          hardFailures: reduced.hardFailures,
          directionalFailures: reduced.directionalFailures,
        },
      };
    },
  });
}
