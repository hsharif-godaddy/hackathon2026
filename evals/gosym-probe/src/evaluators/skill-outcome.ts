import stringify from 'safe-stable-stringify';
import { z } from 'zod';

import { LLMJudgeEvaluator } from './llm-judge-evaluator.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type { Transcript } from '../runner/transcript.js';
import type { Scenario, SkillInstruction } from '../scenarios/types.js';
import {
  reduceChecklistOutcomes,
  type ChecklistItemOutcome,
  type ChecklistItemStatus,
} from './checklist-verdict.js';
import { truncate } from './shared.js';

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

interface JudgedInstruction {
  id: string;
  priority: SkillInstruction['priority'];
  status: ChecklistItemStatus;
  reason: string;
}

/**
 * Whether a judged instruction gates the binary verdict. Only 'required'
 * instructions do; 'advisory' ones are reported as an adherence fraction.
 * Written as an exhaustive switch so a new SkillInstruction priority is a
 * compile error here rather than silently falling out of both the gating
 * filter and the adherence fraction.
 */
function gatesVerdict(priority: SkillInstruction['priority']): boolean {
  switch (priority) {
    case 'required':
      return true;
    case 'advisory':
      return false;
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
      .map((tc) => `- ${tc.name} input=${truncate(stringify(tc.input) ?? '[unserializable]', MAX_TOOL_INPUT_CHARS)}`)
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

function judgeInstructions(
  parsed: SkillOutcomeResult,
  instructions: SkillInstruction[],
): JudgedInstruction[] {
  const byId = new Map(parsed.items.map((p) => [p.id, p]));
  return instructions.map((instr): JudgedInstruction => {
    const judged = byId.get(instr.id);
    if (!judged) {
      return {
        id: instr.id,
        priority: instr.priority,
        status: 'incomplete',
        reason: 'judge did not return a verdict for this instruction',
      };
    }
    return {
      id: instr.id,
      priority: instr.priority,
      status: judged.followed ? 'pass' : 'fail',
      reason: judged.reason,
    };
  });
}

/** Fraction of non-gating (advisory) instructions followed, over those judged. */
function advisoryAdherence(judged: JudgedInstruction[]): number | undefined {
  const evaluated = judged.filter(
    (j) => !gatesVerdict(j.priority) && j.status !== 'incomplete',
  );
  if (evaluated.length === 0) return undefined;
  const followed = evaluated.filter((j) => j.status === 'pass').length;
  return followed / evaluated.length;
}

/**
 * LLM-judge evaluator that checks whether the agent followed specific
 * skill instructions. Only REQUIRED instructions drive the binary
 * pass/fail verdict (via the shared checklist reducer, mapped to
 * 'capability'): any required instruction unmet hard-fails the scenario.
 *
 * ADVISORY instructions are a matter of degree, not a gate — they no
 * longer downgrade the verdict to 'partial' (which deflated pass@k
 * without being a clean fail). They are still judged and their adherence
 * fraction is reported in `details.advisoryAdherence` for visibility, but
 * they never change the pass/fail verdict. (A future score-mode pass can
 * gate advisory adherence statistically if we want it enforced.)
 *
 * Returns 'incomplete' when the scenario has no skillInstructions (non-skill-eval
 * scenarios), or when only advisory instructions exist and no required one is
 * evaluable. Inherits LLMJudgeEvaluator's 429-retry + parse/schema → 'incomplete'
 * handling.
 */
export function createSkillOutcomeEvaluator(
  gocode: IGocodeClient,
): LLMJudgeEvaluator<SkillOutcomeResult> {
  return new LLMJudgeEvaluator<SkillOutcomeResult>(gocode, {
    name: 'skill-outcome',
    comparisonMode: 'passRate',
    schema: SkillOutcomeSchema,
    canEvaluate: (_transcript, scenario) =>
      (scenario.skillInstructions?.length ?? 0) > 0,
    prompt: (transcript, scenario) => buildPrompt(transcript, scenario),
    toEvalResult: (parsed, _transcript, scenario) => {
      const instructions = scenario.skillInstructions ?? [];
      const judged = judgeInstructions(parsed, instructions);
      // Only required instructions gate the verdict; advisory ones are
      // reported as a degree signal and never hard/soft-fail.
      const requiredOutcomes: ChecklistItemOutcome[] = judged
        .filter((j) => gatesVerdict(j.priority))
        .map((j) => ({
          id: j.id,
          status: j.status,
          reason: j.reason,
        }));
      const reduced = reduceChecklistOutcomes(requiredOutcomes);
      const advisory = advisoryAdherence(judged);
      return {
        evaluator: 'skill-outcome',
        score: reduced.score,
        verdict: reduced.verdict,
        reason: reduced.reason,
        details: {
          // JudgedInstruction[] (id/priority/status/reason) — carries
          // `priority` so advisory-vs-required is visible in the report;
          // intentionally NOT ChecklistItemOutcome (the reducer only sees the
          // required subset).
          items: judged,
          passedCount: reduced.passedCount,
          failedCount: reduced.failedCount,
          incompleteCount: reduced.incompleteCount,
          hardFailures: reduced.hardFailures,
          ...(advisory !== undefined && { advisoryAdherence: advisory }),
        },
      };
    },
  });
}
