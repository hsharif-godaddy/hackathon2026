import { z } from 'zod';

import { LLMJudgeEvaluator } from './llm-judge-evaluator.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type { Transcript } from '../runner/transcript.js';
import type { ChecklistItem, Scenario } from '../scenarios/types.js';
import {
  reduceChecklistOutcomes,
  type ChecklistItemOutcome,
} from './checklist-verdict.js';

/** Cap on transcript text fed to the judge — bounds prompt size/cost while
 * keeping enough conversation for per-item judgment. */
const MAX_TRANSCRIPT_CHARS = 6000;

const NarrowJudgeItemSchema = z.object({
  id: z.string(),
  met: z.boolean(),
  reason: z.string().min(1),
});

const NarrowJudgeSchema = z.object({
  items: z.array(NarrowJudgeItemSchema),
});

type NarrowJudgeResult = z.infer<typeof NarrowJudgeSchema>;

const SYSTEM_INSTRUCTIONS = [
  'You are a strict QA reviewer. You are given the user INTENT, a',
  'CHECKLIST of specific expected behaviors, and EVIDENCE from an agent',
  'build (the conversation transcript and the discovered routes of the',
  'generated site).',
  '',
  'Judge ONLY whether each checklist item is met by the evidence. Do not',
  'assess overall quality, aesthetics, or anything outside the listed',
  'items. A behavior counts as met if any valid implementation of it is',
  'present — do not require a specific wording or structure.',
  '',
  'Return JSON only, no prose, in exactly this shape:',
  '{ "items": [ { "id": "<item-id>", "met": true|false,',
  '  "reason": "<short justification>" } ] }',
  'Include one entry per checklist item, using the given ids.',
].join('\n');

function routesBlock(transcript: Transcript): string {
  const site = transcript.capturedSite;
  if (!site || site.routes.length === 0) return '(no routes captured)';
  return site.routes
    .map((r) => `- ${r.path} [${r.status}${r.httpStatus ? ` ${r.httpStatus}` : ''}]`)
    .join('\n');
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

function transcriptBlock(transcript: Transcript): string {
  const text = transcript.turns
    .map((t) => `${t.role}: ${t.content}`)
    .filter((line) => line.length > line.indexOf(':') + 2)
    .join('\n');
  return text.slice(0, MAX_TRANSCRIPT_CHARS) || '(empty transcript)';
}

function checklistBlock(items: ChecklistItem[]): string {
  return items
    .map((i) => `- id=${i.id} [${i.type}]: ${i.description}`)
    .join('\n');
}

function buildPrompt(transcript: Transcript, scenario: Scenario): string {
  const spec = scenario.expectedArtifact;
  const items = spec?.items ?? [];
  return [
    SYSTEM_INSTRUCTIONS,
    '',
    `INTENT: ${spec?.intent ?? scenario.name}`,
    '',
    'CHECKLIST:',
    checklistBlock(items),
    '',
    'EVIDENCE — discovered routes:',
    routesBlock(transcript),
    '',
    'EVIDENCE — rendered content:',
    renderedBlock(transcript),
    '',
    'EVIDENCE — conversation transcript:',
    transcriptBlock(transcript),
  ].join('\n');
}

function toOutcomes(
  parsed: NarrowJudgeResult,
  items: ChecklistItem[],
): ChecklistItemOutcome[] {
  const byId = new Map(parsed.items.map((p) => [p.id, p]));
  return items.map((item): ChecklistItemOutcome => {
    const judged = byId.get(item.id);
    if (!judged) {
      return {
        id: item.id,
        type: item.type,
        status: 'unknown',
        reason: 'judge did not return a verdict for this item',
      };
    }
    return {
      id: item.id,
      type: item.type,
      status: judged.met ? 'pass' : 'fail',
      reason: judged.reason,
    };
  });
}

/**
 * Narrow-scope LLM judge over the SAME checklist items as the static
 * expected-artifact-match evaluator. It judges each item individually
 * (met / not-met), never holistic quality (keeps the judgment narrow to
 * control variance, per the squad's design), then reduces with the
 * shared checklist reducer so its verdict is produced by identical
 * rules — making static-vs-judge disagreement meaningful per item.
 *
 * Inherits LLMJudgeEvaluator's 429-retry + parse/schema → 'unknown'
 * handling. Returns 'unknown' when no expected artifact is defined.
 */
export function createNarrowArtifactJudge(
  gocode: IGocodeClient,
): LLMJudgeEvaluator<NarrowJudgeResult> {
  return new LLMJudgeEvaluator<NarrowJudgeResult>(gocode, {
    name: 'narrow-artifact-judge',
    schema: NarrowJudgeSchema,
    canEvaluate: (_transcript, scenario) =>
      (scenario.expectedArtifact?.items.length ?? 0) > 0,
    prompt: (transcript, scenario) => buildPrompt(transcript, scenario),
    toEvalResult: (parsed, _transcript, scenario) => {
      const items = scenario.expectedArtifact?.items ?? [];
      const outcomes = toOutcomes(parsed, items);
      const reduced = reduceChecklistOutcomes(outcomes);
      return {
        evaluator: 'narrow-artifact-judge',
        score: reduced.score,
        verdict: reduced.verdict,
        reason: reduced.reason,
        ...(scenario.expectedArtifact && {
          evalVersion: scenario.expectedArtifact.evalVersion,
        }),
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
