import type { Evaluator, EvalResult } from '../evaluator.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import {
  LLMJsonEvaluator,
  JudgeNumericalSchema,
  type JudgeNumerical,
} from '../llm-json-evaluator.js';
import { extractBodyHtml, htmlToText, truncate, readSnapshotHtml, LLM_PROMPT_HTML_MAX_CHARS } from '../shared.js';

async function buildHtmlEvidence(scenario: Scenario, snapshot?: DOMSnapshot): Promise<string> {
  const html = await readSnapshotHtml(snapshot);
  const bodyHtml = extractBodyHtml(html);
  const bodyText = truncate(htmlToText(bodyHtml), LLM_PROMPT_HTML_MAX_CHARS);
  const goals = scenario.goals.map((g) => g.description).join('; ');

  return [
    `SCENARIO: ${scenario.name}`,
    `GOALS: ${goals || '(none)'}`,
    '',
    'BODY_HTML:',
    truncate(bodyHtml, LLM_PROMPT_HTML_MAX_CHARS) || '(empty)',
    '',
    'BODY_TEXT:',
    bodyText || '(empty)',
  ].join('\n');
}

function toNumericalResult(
  evaluatorName: string,
  dimension: string,
): (parsed: JudgeNumerical, transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => EvalResult {
  return (parsed, _transcript, _scenario, _snapshot) => ({
    evaluator: evaluatorName,
    score: parsed.verdict === 'unknown' ? 0 : parsed.score,
    verdict: parsed.verdict,
    reason: parsed.reason,
    details: { dimension },
  });
}

async function visualCoherencePrompt(
  _transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
): Promise<string> {
  return [
    'ROLE:',
    'You are an expert web design evaluator assessing visual coherence of rendered HTML.',
    '',
    'Score visual coherence on a scale of 0.0-1.0.',
    'Evaluate: spacing consistency, typography hierarchy, color harmony, and layout rhythm.',
    'Return ONLY valid JSON: {"score": <0.0..1.0>, "verdict": "pass|partial|fail|unknown", "reason": "<1-2 sentences>"}',
    '',
    'Scoring guide:',
    '- 1.0: excellent visual coherence — consistent spacing, clear hierarchy, harmonious palette',
    '- 0.7-0.9: good with minor inconsistencies',
    '- 0.4-0.6: noticeable inconsistencies or generic template look with no coherent design language',
    '- 0.0-0.3: poor cohesion, broken layout, or absent visual design',
    '- unknown: no HTML content to evaluate',
    '',
    await buildHtmlEvidence(scenario, snapshot),
  ].join('\n');
}

async function contentSubstancePrompt(
  _transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
): Promise<string> {
  return [
    'ROLE:',
    'You are an expert content evaluator assessing the substance of web page copy.',
    '',
    'Score content substance on a scale of 0.0-1.0.',
    'Evaluate: specificity vs generic filler, absence of placeholder/lorem-ipsum text,',
    'business-relevant copy, concrete details (names, services, pricing, CTAs), domain vocabulary.',
    'Return ONLY valid JSON: {"score": <0.0..1.0>, "verdict": "pass|partial|fail|unknown", "reason": "<1-2 sentences>"}',
    '',
    'Scoring guide:',
    '- 1.0: fully specific, business-relevant content with no placeholder text',
    '- 0.7-0.9: mostly specific with minor generic sections',
    '- 0.4-0.6: mixed — some real content alongside filler or lorem ipsum',
    '- 0.0-0.3: predominantly placeholder, generic, or missing content',
    '- unknown: no text content to evaluate',
    '',
    await buildHtmlEvidence(scenario, snapshot),
  ].join('\n');
}

export function createQualityLLMEvaluators(gocode: GocodeClient): Evaluator[] {
  const visualCoherence = new LLMJsonEvaluator(gocode, {
    name: 'visual-coherence',
    evalVersion: '1.0',
    schema: JudgeNumericalSchema,
    canEvaluate: (_transcript, _scenario, snapshot) => Boolean(snapshot?.htmlPath || snapshot?.html),
    validateEvidence: async (_transcript, _scenario, snapshot) => {
      const html = await readSnapshotHtml(snapshot);
      const body = extractBodyHtml(html);
      return body.trim().length > 0;
    },
    prompt: visualCoherencePrompt,
    toEvalResult: toNumericalResult('visual-coherence', 'Visual Coherence'),
  });

  const contentSubstance = new LLMJsonEvaluator(gocode, {
    name: 'content-substance',
    evalVersion: '1.0',
    schema: JudgeNumericalSchema,
    canEvaluate: (_transcript, _scenario, snapshot) => Boolean(snapshot?.htmlPath || snapshot?.html),
    validateEvidence: async (_transcript, _scenario, snapshot) => {
      const html = await readSnapshotHtml(snapshot);
      const body = extractBodyHtml(html);
      return body.trim().length > 0;
    },
    prompt: contentSubstancePrompt,
    toEvalResult: toNumericalResult('content-substance', 'Content Substance'),
  });

  return [visualCoherence, contentSubstance];
}
