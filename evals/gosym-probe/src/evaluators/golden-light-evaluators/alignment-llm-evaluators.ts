import type { Evaluator, EvalResult } from '../evaluator.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import {
  LLMJsonEvaluator,
  JudgeNumericalSchema,
  type JudgeNumerical,
} from '../llm-json-evaluator.js';
import { readSnapshotHtml, extractBodyHtml } from '../shared.js';
import { buildAlignmentEvidence } from './alignment-evidence.js';

/** Bump when any prompt-contributing function in this directory changes. */
export const ALIGNMENT_EVAL_VERSION = '2.0';

interface BaseAlignmentSpec {
  readonly name: string;
  readonly dimension: string;
  readonly description: string;
  readonly inputsUsed: readonly string[];
  readonly regressionMode: 'passRate' | 'score';
  readonly lowerIsBetter: boolean;
}

interface NumericalAlignmentSpec extends BaseAlignmentSpec {
  readonly scoreType: 'numerical';
}

type AlignmentSpec = NumericalAlignmentSpec;

const SPECS: AlignmentSpec[] = [
  {
    name: 'intent-to-output-alignment',
    dimension: 'Intent Understanding & Alignment',
    scoreType: 'numerical',
    regressionMode: 'score',
    lowerIsBetter: false,
    description:
      'Whether the final website output matches the user intent expressed in the conversation. Verify the site structure, content, and CTAs support the stated goal and key requirements.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'implicit-feature-gap',
    dimension: 'Implicit Feature Completeness',
    scoreType: 'numerical',
    regressionMode: 'score',
    lowerIsBetter: false,
    description:
      'How completely the final site covers implied features a reasonable user would expect given the intent and domain, such as contact info, pricing, booking, map, or CTA placement. Evaluate rendered section content only — do not treat navigation links or planning artifacts pointing to unbuilt sections as evidence of a gap.',
    inputsUsed: ['conversation', 'final_artifacts'],
  },
  {
    name: 'silent-hallucination',
    dimension: 'Consistency & Truthfulness',
    scoreType: 'numerical',
    regressionMode: 'score',
    lowerIsBetter: false,
    description:
      'How well all agent claims are supported by tool calls and final artifacts. Score high when every stated capability (integrations, emails, analytics, publishing) is backed by observable evidence.',
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
  const verdictGuide = [
    'Verdict guide (advisory — only "unknown" has a functional effect):',
    '- pass: strong supporting evidence that requirements are met',
    '- partial: mixed evidence; meaningful gaps but not a total failure',
    '- fail: clear violation or missing requirement, supported by evidence',
    '- unknown: ONLY when evidence is genuinely insufficient to judge — use pass/partial/fail for ambiguous cases',
  ].join('\n');

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
      verdictGuide,
      '',
      await buildAlignmentEvidence(transcript, scenario, snapshot),
    ].join('\n');
}

function mapScoreMode(
  spec: NumericalAlignmentSpec,
): (parsed: JudgeNumerical, transcript: Transcript) => EvalResult {
  return (parsed, transcript) => ({
    evaluator: spec.name,
    score: parsed.verdict === 'unknown' ? 0 : parsed.score,
    verdict: parsed.verdict === 'unknown' ? 'unknown' : 'observed',
    reason: parsed.reason,
    details: {
      dimension: spec.dimension,
      inputsUsed: spec.inputsUsed,
      advisoryVerdict: parsed.verdict,
      transcriptErrors: transcript.errors.length,
    },
  });
}

function createEvaluatorFromSpec(gocode: IGocodeClient, spec: AlignmentSpec): Evaluator {
  const canEvaluate = (transcript: Transcript): boolean => transcript.turns.length > 0;

  const validateEvidence = async (
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<boolean> => {
    const html = await readSnapshotHtml(snapshot);
    return extractBodyHtml(html).trim().length > 0;
  };

  return new LLMJsonEvaluator(gocode, {
    name: spec.name,
    evalVersion: ALIGNMENT_EVAL_VERSION,
    regressionMode: spec.regressionMode,
    lowerIsBetter: spec.lowerIsBetter,
    schema: JudgeNumericalSchema,
    canEvaluate,
    validateEvidence,
    prompt: numericalPrompt(spec),
    toEvalResult: mapScoreMode(spec),
  });
}

export function createAlignmentLLMEvaluators(gocode: IGocodeClient): Evaluator[] {
  return SPECS.map((spec) => createEvaluatorFromSpec(gocode, spec));
}
