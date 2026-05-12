import type { Evaluator, EvalResult } from '../evaluator.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import {
  LLMJsonEvaluator,
  JudgeNumericalSchema,
  JudgeBooleanSchema,
  type JudgeNumerical,
  type JudgeBoolean,
} from '../llm-json-evaluator.js';
import { clamp01, readSnapshotHtml, extractBodyHtml } from '../shared.js';
import { buildAlignmentEvidence } from './alignment-evidence.js';

/** Bump when any prompt-contributing function in this directory changes. */
export const ALIGNMENT_EVAL_VERSION = '1.0';

interface BaseAlignmentSpec {
  readonly name: string;
  readonly dimension: string;
  readonly description: string;
  readonly inputsUsed: readonly string[];
}

interface NumericalAlignmentSpec extends BaseAlignmentSpec {
  readonly scoreType: 'numerical';
}

interface BooleanAlignmentSpec extends BaseAlignmentSpec {
  readonly scoreType: 'boolean';
  readonly booleanTrueIsGood: boolean;
}

type AlignmentSpec = NumericalAlignmentSpec | BooleanAlignmentSpec;

const SPECS: AlignmentSpec[] = [
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
    booleanTrueIsGood: false,
    description:
      'Whether the final site is missing important implied features that a reasonable user would expect given the intent and domain, such as contact info, pricing, booking, map, or CTA placement.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'scope-drift-overgeneration',
    dimension: 'Scope Control',
    scoreType: 'boolean',
    booleanTrueIsGood: false,
    description:
      'Whether the agent added unnecessary pages or features unsupported by user intent, especially if they increase complexity, risk, maintenance, or contradict user preferences.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'silent-hallucination',
    dimension: 'Consistency & Truthfulness',
    scoreType: 'boolean',
    booleanTrueIsGood: false,
    description:
      'Whether the agent implies or asserts capabilities that are not backed by tool calls or final artifacts, such as working integrations, sent emails, configured analytics, or completed publishing.',
    inputsUsed: ['conversation', 'tool_calls', 'final_artifacts'],
  },
];

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

function judgeHeader(spec: AlignmentSpec): string {
  return [
    `EVALUATOR: ${spec.name}`,
    `DIMENSION: ${spec.dimension}`,
    `DESCRIPTION: ${spec.description.trim()}`,
    spec.inputsUsed.length > 0
      ? `Inputs you may use: ${spec.inputsUsed.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function numericalPrompt(
  spec: NumericalAlignmentSpec,
): (transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => Promise<string> {
  return async (transcript, scenario, snapshot) =>
    [
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
      await buildAlignmentEvidence(transcript, scenario, snapshot),
    ].join('\n');
}

function booleanPrompt(
  spec: BooleanAlignmentSpec,
): (transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => Promise<string> {
  return async (transcript, scenario, snapshot) =>
    [
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
      await buildAlignmentEvidence(transcript, scenario, snapshot),
    ].join('\n');
}

function mapNumerical(
  spec: NumericalAlignmentSpec,
): (parsed: JudgeNumerical, transcript: Transcript) => EvalResult {
  return (parsed, transcript) => {
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

function mapBoolean(
  spec: BooleanAlignmentSpec,
): (parsed: JudgeBoolean, transcript: Transcript) => EvalResult {
  return (parsed, transcript) => {
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

function assertNever(value: never): never {
  throw new Error(`Unsupported alignment evaluator score type: ${String(value)}`);
}

function createEvaluatorFromSpec(gocode: GocodeClient, spec: AlignmentSpec): Evaluator {
  const canEvaluate = (transcript: Transcript): boolean => transcript.turns.length > 0;

  const validateEvidence = async (
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<boolean> => {
    const html = await readSnapshotHtml(snapshot);
    return extractBodyHtml(html).trim().length > 0;
  };

  if (spec.scoreType === 'numerical') {
    return new LLMJsonEvaluator(gocode, {
      name: spec.name,
      evalVersion: ALIGNMENT_EVAL_VERSION,
      schema: JudgeNumericalSchema,
      canEvaluate,
      validateEvidence,
      prompt: numericalPrompt(spec),
      toEvalResult: mapNumerical(spec),
    });
  }

  if (spec.scoreType === 'boolean') {
    return new LLMJsonEvaluator(gocode, {
      name: spec.name,
      evalVersion: ALIGNMENT_EVAL_VERSION,
      schema: JudgeBooleanSchema,
      canEvaluate,
      validateEvidence,
      prompt: booleanPrompt(spec),
      toEvalResult: mapBoolean(spec),
    });
  }

  return assertNever(spec);
}

export function createAlignmentLLMEvaluators(gocode: GocodeClient): Evaluator[] {
  return SPECS.map((spec) => createEvaluatorFromSpec(gocode, spec));
}
