import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Evaluator, EvalResult } from '../evaluator.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';

import { LLMJudgeEvaluator } from './llm-judge-evaluator.js';
import type {
  JudgeBoolean,
  JudgeCategorical,
  JudgeNumerical,
} from './llm-judge-evaluator.js';
import {
  JudgeBooleanSchema,
  JudgeCategoricalSchema,
  JudgeNumericalSchema,
} from './llm-judge-evaluator.js';
import { buildEvidence, clamp01, extractBodyHtml, htmlToText, lastSnapshotSectionSanitized, truncate } from './shared.js';
import { readSnapshotHtml } from '../shared.js';

type ScoreType = 'numerical' | 'boolean' | 'categorical';
type EvidenceInput =
  | 'conversation'
  | 'tool_calls'
  | 'final_artifacts'
  | 'metadata';

export type BaselineEvaluatorName =
  | 'intent-inference-quality'
  | 'intent-to-output-alignment'
  | 'implicit-feature-gap'
  | 'trust-signal-coverage'
  | 'scope-drift-overgeneration'
  | 'primary-use-case-support'
  | 'conversion-path-clarity'
  | 'content-tone-alignment'
  | 'content-specificity'
  | 'conversation-to-artifact-consistency'
  | 'silent-hallucination'
  | 'ambiguity-handling-quality'
  | 'flow-efficiency'
  | 'structural-coherence'
  | 'visual-layout-sanity';

interface BaseBaselineEvaluatorSpec {
  name: BaselineEvaluatorName;
  dimension: string;
  description: string;
  inputsUsed: EvidenceInput[];
}

interface NumericalBaselineEvaluatorSpec extends BaseBaselineEvaluatorSpec {
  scoreType: 'numerical';
}

interface BooleanBaselineEvaluatorSpec extends BaseBaselineEvaluatorSpec {
  scoreType: 'boolean';
  booleanTrueIsGood: boolean;
}

interface CategoricalBaselineEvaluatorSpec extends BaseBaselineEvaluatorSpec {
  scoreType: 'categorical';
  allowedValues: [string, ...string[]];
}

type BaselineEvaluatorSpec =
  | NumericalBaselineEvaluatorSpec
  | BooleanBaselineEvaluatorSpec
  | CategoricalBaselineEvaluatorSpec;

function assertNever(value: never): never {
  throw new Error(`Unsupported baseline evaluator score type: ${String(value)}`);
}

function version(spec: BaselineEvaluatorSpec): string {
  return createHash('sha256')
    .update(JSON.stringify({
      spec,
      promptSource: {
        protocol: String(protocol),
        judgeHeader: String(judgeHeader),
        baseEvidence: String(baseEvidence),
        numericalPrompt: String(numericalPrompt),
        booleanPrompt: String(booleanPrompt),
        categoricalPrompt: String(categoricalPrompt),
        buildEvidence: String(buildEvidence),
        truncate: String(truncate),
        lastSnapshotSectionSanitized: String(lastSnapshotSectionSanitized),
        readSnapshotHtml: String(readSnapshotHtml),
        extractBodyHtml: String(extractBodyHtml),
        htmlToText: String(htmlToText),
      },
      promptFamily: 'baseline-llm-evaluators-v1',
    }))
    .digest('hex')
    .slice(0, 16);
}

function verdictToScore(verdict: EvalResult['verdict']): number {
  if (verdict === 'pass') return 1.0;
  if (verdict === 'partial') return 0.5;
  if (verdict === 'fail') return 0.0;
  return 0.0;
}

function judgeHeader(spec: BaselineEvaluatorSpec): string {
  return [
    `EVALUATOR: ${spec.name}`,
    `DIMENSION: ${spec.dimension}`,
    `DESCRIPTION: ${spec.description.trim()}`,
    spec.inputsUsed.length > 0
      ? `Inputs you may use: ${spec.inputsUsed.join(', ')}`
      : '',
    spec.scoreType === 'categorical'
      ? `Allowed values: ${spec.allowedValues.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function protocol(): string {
  return [
    'EVALUATION PROTOCOL:',
    '- Use ONLY the evidence below. Do not assume unstated facts.',
    '- Prefer outcome-based signals over exact phrasing.',
    '- If evidence is insufficient or ambiguous, return verdict=unknown.',
    '- Treat tool errors/timeouts as failures ONLY if they block the goal.',
    '- gosym-probe is a local harness: evaluate preview/local DOM, conversation, tool traces, and artifacts; do not require production publishing.',
    '- Do not penalize failed, missing, or timed-out publish/deployment/public-URL evidence unless the scenario explicitly tests publishing.',
    '- Do not penalize for benign optional omissions unless clearly required.',
    '- In your reason, cite 1-3 concrete observations from the evidence.',
  ].join('\n');
}

async function baseEvidence(
  transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
): Promise<string> {
  const evidence = await buildEvidence(transcript, snapshot);
  return [
    `SCENARIO: ${scenario.name}`,
    `GOALS: ${scenario.goals.map((goal) => goal.description).join('; ') || '(none)'}`,
    '',
    'PERSONA_SYSTEM_PROMPT:',
    truncate(scenario.persona.systemPrompt ?? '', 3_000) || '(none)',
    '',
    '---',
    'CONVERSATION:',
    evidence.conversation,
    '',
    'TOOL_CALLS (summarized):',
    evidence.tools,
    '',
    'FINAL_SITE (last snapshot):',
    evidence.finalSite,
    '---',
    '',
    `META: totalToolCalls=${evidence.totalToolCalls} transcriptErrors=${transcript.errors.length}`,
  ].join('\n');
}

function numericalPrompt(spec: NumericalBaselineEvaluatorSpec): (
  transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
) => Promise<string> {
  return async (transcript, scenario, snapshot) => [
    'ROLE:',
    'You are an expert evaluator for a browser-based website builder agent.',
    '',
    protocol(),
    '',
    judgeHeader(spec),
    '',
    'Return ONLY valid JSON with this schema:',
    '{"score": <0.0..1.0>, "verdict": "pass|partial|fail|unknown", "reason": "<brief>"}',
    '',
    'Scoring guide:',
    '- 1.0: excellent / fully satisfied',
    '- 0.7-0.9: good, minor gaps',
    '- 0.4-0.6: partial, notable gaps',
    '- 0.0-0.3: poor / failed',
    '- unknown: evidence is insufficient to judge',
    '',
    'Verdict guide:',
    '- pass: requirements are met with strong supporting evidence',
    '- partial: mixed evidence; meaningful gaps but not a total failure',
    '- fail: clear violation or missing requirement, supported by evidence',
    '- unknown: cannot determine from evidence provided',
    '',
    await baseEvidence(transcript, scenario, snapshot),
  ].join('\n');
}

function booleanPrompt(spec: BooleanBaselineEvaluatorSpec): (
  transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
) => Promise<string> {
  return async (transcript, scenario, snapshot) => [
    'ROLE:',
    'You are an expert evaluator for a browser-based website builder agent.',
    '',
    protocol(),
    '',
    judgeHeader(spec),
    '',
    `Boolean polarity: ${spec.booleanTrueIsGood ? 'value=true means the requirement is satisfied (good)' : 'value=true means a problem is present (bad)'}.`,
    '',
    'Return ONLY valid JSON with this schema:',
    '{"value": <true|false>, "verdict": "pass|partial|fail|unknown", "reason": "<brief>"}',
    '',
    'Use verdict=unknown if evidence is insufficient.',
    await baseEvidence(transcript, scenario, snapshot),
  ].join('\n');
}

function categoricalPrompt(spec: CategoricalBaselineEvaluatorSpec): (
  transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
) => Promise<string> {
  return async (transcript, scenario, snapshot) => [
    'ROLE:',
    'You are an expert evaluator for a browser-based website builder agent.',
    '',
    protocol(),
    '',
    judgeHeader(spec),
    '',
    `Allowed values: ${spec.allowedValues.join(', ')}`,
    '',
    'Return ONLY valid JSON with this schema:',
    '{"value": "<one allowed value>", "verdict": "pass|partial|fail|unknown", "reason": "<brief>"}',
    '',
    'Use verdict=unknown if evidence is insufficient.',
    await baseEvidence(transcript, scenario, snapshot),
  ].join('\n');
}

function mapNumerical(spec: NumericalBaselineEvaluatorSpec) {
  return (parsed: JudgeNumerical, transcript: Transcript): EvalResult => {
    const unknown = parsed.verdict === 'unknown';
    return {
      evaluator: spec.name,
      score: unknown ? 0 : clamp01(parsed.score),
      verdict: parsed.verdict,
      reason: parsed.reason,
      details: {
        dimension: spec.dimension,
        inputsUsed: spec.inputsUsed,
        transcriptErrors: transcript.errors.length,
      },
    };
  };
}

function mapBoolean(spec: BooleanBaselineEvaluatorSpec) {
  return (parsed: JudgeBoolean, transcript: Transcript): EvalResult => {
    if (parsed.verdict === 'unknown') {
      return {
        evaluator: spec.name,
        score: 0,
        verdict: 'unknown',
        reason: parsed.reason,
        details: {
          dimension: spec.dimension,
          inputsUsed: spec.inputsUsed,
        },
      };
    }

    const ok = spec.booleanTrueIsGood ? parsed.value : !parsed.value;

    return {
      evaluator: spec.name,
      score: ok ? 1.0 : 0.0,
      verdict: ok ? 'pass' : 'fail',
      reason: parsed.reason,
      details: {
        dimension: spec.dimension,
        inputsUsed: spec.inputsUsed,
        value: parsed.value,
        transcriptErrors: transcript.errors.length,
      },
    };
  };
}

function mapCategorical(spec: CategoricalBaselineEvaluatorSpec) {
  return (parsed: JudgeCategorical, transcript: Transcript): EvalResult => ({
    evaluator: spec.name,
    score: parsed.verdict === 'unknown' ? 0 : verdictToScore(parsed.verdict),
    verdict: parsed.verdict,
    reason: parsed.reason,
    details: {
      dimension: spec.dimension,
      inputsUsed: spec.inputsUsed,
      value: parsed.value,
      transcriptErrors: transcript.errors.length,
    },
  });
}

const BASELINE_SPECS: BaselineEvaluatorSpec[] = [
  {
    name: 'intent-inference-quality',
    dimension: 'Intent Understanding & Alignment',
    scoreType: 'numerical',
    description:
      'How well the agent inferred the user intent, constraints, and priorities from the conversation. Score low if it misreads the business type, primary goal, tone, or stated constraints.',
    inputsUsed: ['conversation', 'tool_calls', 'final_artifacts'],
  },
  {
    name: 'intent-to-output-alignment',
    dimension: 'Intent Understanding & Alignment',
    scoreType: 'numerical',
    description:
      'Whether the final website output matches the user intent expressed in the conversation. Verify the site structure, content, and CTAs support the stated goal and key requirements.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'implicit-feature-gap',
    dimension: 'Implicit Feature Completeness',
    scoreType: 'boolean',
    description:
      'Whether the final site is missing important implied features that a reasonable user would expect given the intent and domain, such as contact info, pricing, booking, map, or CTA placement.',
    booleanTrueIsGood: false,
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'trust-signal-coverage',
    dimension: 'Implicit Feature Completeness',
    scoreType: 'numerical',
    description:
      'Presence and quality of trust-building elements appropriate to the business context, such as contact info, hours, testimonials, policies, team/about details, certifications, and next-step messaging.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'scope-drift-overgeneration',
    dimension: 'Scope Control',
    scoreType: 'boolean',
    description:
      'Whether the agent added unnecessary pages or features unsupported by user intent, especially if they increase complexity, risk, maintenance, or contradict user preferences.',
    booleanTrueIsGood: false,
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'primary-use-case-support',
    dimension: 'Conversion Effectiveness',
    scoreType: 'numerical',
    description:
      'How well the final site supports the primary visitor action inferred from the conversation, such as booking, requesting a quote, ordering, signing up, or joining a list.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'conversion-path-clarity',
    dimension: 'Conversion Effectiveness',
    scoreType: 'numerical',
    description:
      'Clarity of the visitor next step. Check if primary CTAs are obvious, plain-language, consistent, and lead to a functional form, booking flow, contact method, or purchase path.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'content-tone-alignment',
    dimension: 'Content Quality & Fit',
    scoreType: 'numerical',
    description:
      'Whether writing and visual voice align with the brand tone implied by the user, such as friendly vs formal, playful vs clinical, premium vs budget, or practical vs aspirational.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'content-specificity',
    dimension: 'Content Quality & Fit',
    scoreType: 'numerical',
    description:
      'Whether content is specific, business-relevant, and actionable instead of generic filler. Look for concrete services, pricing, location, hours, policies, FAQs, and domain language.',
    inputsUsed: ['final_artifacts'],
  },
  {
    name: 'conversation-to-artifact-consistency',
    dimension: 'Consistency & Truthfulness',
    scoreType: 'numerical',
    description:
      'Whether agent commitments in conversation match what is actually present in final artifacts. Verify claims like added booking forms, pricing, gallery, email wiring, or publish status.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'silent-hallucination',
    dimension: 'Consistency & Truthfulness',
    scoreType: 'boolean',
    description:
      'Whether the agent implies or asserts capabilities that are not backed by tool calls or final artifacts, such as working integrations, sent emails, configured analytics, or completed publishing.',
    booleanTrueIsGood: false,
    inputsUsed: ['conversation', 'tool_calls', 'final_artifacts'],
  },
  {
    name: 'ambiguity-handling-quality',
    dimension: 'Ambiguity Handling',
    scoreType: 'categorical',
    allowedValues: ['good', 'acceptable', 'poor'],
    description:
      'How well the agent handled vague or incomplete input. Good means targeted questions or sensible defaults while keeping progress moving. Poor means risky assumptions or mismatch.',
    inputsUsed: ['conversation'],
  },
  {
    name: 'flow-efficiency',
    dimension: 'Interaction Quality',
    scoreType: 'numerical',
    description:
      'Efficiency of the interaction relative to task complexity, including turns, loops, repeated questions, unnecessary back-and-forth, and purposeful tool usage.',
    inputsUsed: ['conversation', 'tool_calls', 'metadata'],
  },
  {
    name: 'structural-coherence',
    dimension: 'Structural & Visual Coherence',
    scoreType: 'numerical',
    description:
      'Logical organization of pages, sections, and navigation. Check for clear nav labels, coherent information hierarchy, and appropriate grouping for the user mental model.',
    inputsUsed: ['final_artifacts'],
  },
  {
    name: 'visual-layout-sanity',
    dimension: 'Structural & Visual Coherence',
    scoreType: 'categorical',
    allowedValues: ['good', 'acceptable', 'poor'],
    description:
      'Whether the layout is usable and not visibly broken in final artifacts. Good means readable, spaced, visible CTAs, and intentional layout. Poor means overlap, unreadable text, or incomplete pages.',
    inputsUsed: ['final_artifacts'],
  },
];

const BASELINE_SPEC_BY_NAME = new Map<BaselineEvaluatorName, BaselineEvaluatorSpec>(
  BASELINE_SPECS.map((spec) => [spec.name, spec]),
);

function createEvaluatorFromSpec(
  gocode: IGocodeClient,
  spec: BaselineEvaluatorSpec,
): Evaluator {
  if (spec.scoreType === 'numerical') {
    return new LLMJudgeEvaluator(gocode, {
      name: spec.name,
      evalVersion: version(spec),
      schema: JudgeNumericalSchema,
      prompt: numericalPrompt(spec),
      toEvalResult: mapNumerical(spec),
    });
  }

  if (spec.scoreType === 'boolean') {
    return new LLMJudgeEvaluator(gocode, {
      name: spec.name,
      evalVersion: version(spec),
      schema: JudgeBooleanSchema,
      prompt: booleanPrompt(spec),
      toEvalResult: mapBoolean(spec),
    });
  }

  if (spec.scoreType === 'categorical') {
    return new LLMJudgeEvaluator(gocode, {
      name: spec.name,
      evalVersion: version(spec),
      schema: JudgeCategoricalSchema.extend({
        value: z.enum(spec.allowedValues),
      }),
      prompt: categoricalPrompt(spec),
      toEvalResult: mapCategorical(spec),
    });
  }

  return assertNever(spec);
}

export function createBaselineLLMEvaluators(
  gocode: IGocodeClient,
): Evaluator[] {
  return BASELINE_SPECS.map((spec) => createEvaluatorFromSpec(gocode, spec));
}

export function createSelectiveBaselineLLMEvaluators(
  gocode: IGocodeClient,
  names: readonly BaselineEvaluatorName[],
): Evaluator[] {
  const unknown = names.filter((n) => !BASELINE_SPEC_BY_NAME.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown baseline evaluator names: ${unknown.join(', ')}. ` +
        `Valid names: ${[...BASELINE_SPEC_BY_NAME.keys()].join(', ')}`,
    );
  }
  return names.map((n) => {
    // Safe: upfront validation guarantees all names exist in the map
    const spec = BASELINE_SPEC_BY_NAME.get(n)!;
    return createEvaluatorFromSpec(gocode, spec);
  });
}
