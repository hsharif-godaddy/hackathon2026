import { z } from 'zod';

import type { Evaluator, EvalResult } from '../evaluator.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { ChecklistItemOutcome } from '../checklist-verdict.js';
import { reduceChecklistOutcomes } from '../checklist-verdict.js';
import {
  LLMJudgeEvaluator,
} from '../llm-judge-evaluator.js';
import {
  extractBodyHtml,
  extractBodyHtmlFull,
  sanitizeHtmlForEval,
  htmlToText,
  truncate,
  readSnapshotHtml,
  LLM_PROMPT_HTML_MAX_CHARS,
  LLM_PROMPT_SANITIZED_HTML_MAX_CHARS,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Shared checklist schema (mirrors skill-outcome.ts)
// ---------------------------------------------------------------------------

const JudgeChecklistItemSchema = z.object({
  id: z.string(),
  met: z.boolean(),
  reason: z.string(),
});

const JudgeChecklistSchema = z.object({
  items: z.array(JudgeChecklistItemSchema),
});

type JudgeChecklist = z.infer<typeof JudgeChecklistSchema>;

// ---------------------------------------------------------------------------
// Dimension definitions
// ---------------------------------------------------------------------------

type CheckType = 'invariance' | 'directional';

interface DimensionDef {
  id: string;
  type: CheckType;
}

const VISUAL_COHERENCE_DIMENSIONS: ReadonlyArray<DimensionDef> = [
  { id: 'spacing-consistency', type: 'directional' },
  { id: 'typography-hierarchy', type: 'directional' },
  { id: 'color-harmony', type: 'directional' },
  { id: 'layout-rhythm', type: 'directional' },
];

const CONTENT_SUBSTANCE_DIMENSIONS: ReadonlyArray<DimensionDef> = [
  { id: 'no-placeholder-text', type: 'invariance' },
  { id: 'content-specificity', type: 'directional' },
  { id: 'concrete-details', type: 'directional' },
  { id: 'domain-vocabulary', type: 'directional' },
];

// ---------------------------------------------------------------------------
// Map judge response to typed checklist outcomes
// ---------------------------------------------------------------------------

function toChecklistOutcomes(
  parsed: JudgeChecklist,
  dimensions: ReadonlyArray<DimensionDef>,
): ChecklistItemOutcome[] {
  const byId = new Map(parsed.items.map((item) => [item.id, item]));
  return dimensions.map((dim): ChecklistItemOutcome => {
    const judged = byId.get(dim.id);
    if (!judged) {
      return { id: dim.id, type: dim.type, status: 'incomplete', reason: 'judge did not return a verdict for this dimension' };
    }
    return {
      id: dim.id,
      type: dim.type,
      status: judged.met ? 'pass' : 'fail',
      reason: judged.reason,
    };
  });
}

// ---------------------------------------------------------------------------
// Shared result builder
// ---------------------------------------------------------------------------

function buildDirectionalResult(
  evaluatorName: string,
  items: ChecklistItemOutcome[],
): EvalResult {
  const evaluable = items.filter((i) => i.status !== 'incomplete');
  const allIncomplete = evaluable.length === 0;
  const passed = evaluable.filter((i) => i.status === 'pass').length;
  const score = allIncomplete ? 0 : passed / evaluable.length;

  return {
    evaluator: evaluatorName,
    score,
    verdict: allIncomplete ? 'incomplete' : 'directional',
    reason: allIncomplete
      ? 'No dimension could be evaluated (insufficient data)'
      : `${passed}/${evaluable.length} dimensions met`,
    details: { items },
  };
}

// ---------------------------------------------------------------------------
// Memoizing evaluator wrapper
//
// The runner calls each evaluator once per trial (suite-runner.ts:876,882).
// Both the passrate track and the scoremode track will call the same judge
// evaluator. This wrapper ensures the underlying LLM call happens exactly
// once per trial by caching on trial snapshot/transcript object identity.
// The WeakMap keys are held weakly, so cache entries are GC'd with the trial
// objects — no manual lifecycle needed.
// ---------------------------------------------------------------------------

class MemoizedLLMJudgeEvaluator<T> implements Evaluator {
  readonly name: string;
  readonly evalVersion?: string;
  readonly comparisonMode: 'passRate' | 'score';

  private readonly inner: LLMJudgeEvaluator<T>;
  private readonly cache: WeakMap<object, Promise<EvalResult>>;

  constructor(inner: LLMJudgeEvaluator<T>) {
    this.inner = inner;
    this.name = inner.name;
    this.evalVersion = inner.evalVersion;
    this.comparisonMode = inner.comparisonMode;
    this.cache = new WeakMap<object, Promise<EvalResult>>();
  }

  evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const key: object = snapshot ?? transcript;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.inner.evaluate(transcript, scenario, snapshot);
    this.cache.set(key, pending);
    return pending;
  }
}

// ---------------------------------------------------------------------------
// Content-substance adapter evaluators
//
// Both adapters call .evaluate() on the same MemoizedLLMJudgeEvaluator
// instance. The memo caches the Promise — even concurrent calls in a
// Promise.all get the same Promise and make only one LLM call.
// ---------------------------------------------------------------------------

class ContentSubstanceInvEvaluator implements Evaluator {
  readonly name = 'content-substance-inv';
  readonly comparisonMode = 'passRate' as const;
  readonly evalVersion: string;

  constructor(private readonly shared: MemoizedLLMJudgeEvaluator<JudgeChecklist>) {
    this.evalVersion = shared.evalVersion ?? '2.0';
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const base = await this.shared.evaluate(transcript, scenario, snapshot);
    if (base.verdict === 'incomplete') {
      return { ...base, evaluator: this.name };
    }
    const allItems = (base.details?.['items'] ?? []) as ChecklistItemOutcome[];
    const invItems = allItems.filter((i) => i.type === 'invariance');
    const reduced = reduceChecklistOutcomes(invItems);
    return {
      evaluator: this.name,
      score: reduced.score,
      verdict: reduced.verdict,
      reason: reduced.reason,
      details: { items: invItems, hardFailures: reduced.hardFailures },
      evalVersion: this.evalVersion,
    };
  }
}

class ContentSubstanceDirEvaluator implements Evaluator {
  readonly name = 'content-substance-dir';
  readonly comparisonMode = 'score' as const;
  readonly evalVersion: string;

  constructor(private readonly shared: MemoizedLLMJudgeEvaluator<JudgeChecklist>) {
    this.evalVersion = shared.evalVersion ?? '2.0';
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const base = await this.shared.evaluate(transcript, scenario, snapshot);
    if (base.verdict === 'incomplete') {
      return { ...base, evaluator: this.name };
    }
    const allItems = (base.details?.['items'] ?? []) as ChecklistItemOutcome[];
    const dirItems = allItems.filter((i) => i.type === 'directional');
    const evaluable = dirItems.filter((i) => i.status !== 'incomplete');
    if (evaluable.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No directional content-substance checks could be evaluated',
        details: { items: dirItems },
        evalVersion: this.evalVersion,
      };
    }
    const passed = evaluable.filter((i) => i.status === 'pass').length;
    const score = passed / evaluable.length;
    return {
      evaluator: this.name,
      score,
      verdict: 'directional',
      reason: `${passed}/${evaluable.length} directional content checks met`,
      details: { items: dirItems },
      evalVersion: this.evalVersion,
    };
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

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

async function buildSanitizedHtmlEvidence(scenario: Scenario, snapshot?: DOMSnapshot): Promise<string> {
  const html = await readSnapshotHtml(snapshot);
  const bodyHtml = extractBodyHtmlFull(html);
  const sanitizedHtml = truncate(sanitizeHtmlForEval(bodyHtml), LLM_PROMPT_SANITIZED_HTML_MAX_CHARS);
  const bodyText = htmlToText(sanitizedHtml);
  const goals = scenario.goals.map((g) => g.description).join('; ');

  return [
    `SCENARIO: ${scenario.name}`,
    `GOALS: ${goals || '(none)'}`,
    '',
    'BODY_HTML (sanitized):',
    sanitizedHtml || '(empty)',
    '',
    'BODY_TEXT:',
    bodyText || '(empty)',
  ].join('\n');
}

async function visualCoherencePrompt(
  _transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
): Promise<string> {
  const dimensionList = VISUAL_COHERENCE_DIMENSIONS.map((d) => `  - ${d.id}`).join('\n');
  return [
    'ROLE:',
    'You are an expert web design evaluator assessing visual coherence of rendered HTML.',
    '',
    'For each dimension listed below, evaluate whether the rendered page meets it.',
    'Return ONLY valid JSON matching this schema exactly:',
    '{ "items": [ { "id": "<dimension-id>", "met": true|false, "reason": "<1 sentence>" } ] }',
    'Include exactly one entry per dimension id.',
    '',
    'DIMENSIONS TO EVALUATE:',
    dimensionList,
    '',
    'Dimension definitions:',
    '  spacing-consistency: consistent spacing units/scale throughout (no random gaps)',
    '  typography-hierarchy: clear visual hierarchy via font size/weight/contrast',
    '  color-harmony: coherent colour palette (not clashing or arbitrary)',
    '  layout-rhythm: consistent grid/rhythm; elements align predictably',
    '',
    await buildHtmlEvidence(scenario, snapshot),
  ].join('\n');
}

async function contentSubstancePrompt(
  _transcript: Transcript,
  scenario: Scenario,
  snapshot?: DOMSnapshot,
): Promise<string> {
  const dimensionList = CONTENT_SUBSTANCE_DIMENSIONS.map((d) => `  - ${d.id}`).join('\n');
  return [
    'ROLE:',
    'You are an expert content evaluator assessing the substance of web page copy.',
    '',
    'For each dimension listed below, evaluate whether the rendered page meets it.',
    'Return ONLY valid JSON matching this schema exactly:',
    '{ "items": [ { "id": "<dimension-id>", "met": true|false, "reason": "<1 sentence>" } ] }',
    'Include exactly one entry per dimension id.',
    '',
    'DIMENSIONS TO EVALUATE:',
    dimensionList,
    '',
    'Dimension definitions:',
    '  no-placeholder-text: zero lorem-ipsum, "placeholder", or filler text on the page',
    '  content-specificity: copy is specific to this business (not generic template boilerplate)',
    '  concrete-details: at least one concrete detail (name, service, price, CTA, location)',
    '  domain-vocabulary: uses vocabulary appropriate to the business domain',
    '',
    await buildSanitizedHtmlEvidence(scenario, snapshot),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface QualityLLMEvaluators {
  visualCoherence: Evaluator;
  contentSubstanceInv: ContentSubstanceInvEvaluator;
  contentSubstanceDir: ContentSubstanceDirEvaluator;
}

export function createQualityLLMEvaluators(gocode: IGocodeClient): QualityLLMEvaluators {
  const visualCoherenceInner = new LLMJudgeEvaluator<JudgeChecklist>(gocode, {
    name: 'visual-coherence',
    evalVersion: '2.0',
    comparisonMode: 'score',
    schema: JudgeChecklistSchema,
    canEvaluate: (_transcript, _scenario, snapshot) => Boolean(snapshot?.htmlPath || snapshot?.html),
    validateEvidence: async (_transcript, _scenario, snapshot) => {
      const html = await readSnapshotHtml(snapshot);
      const body = extractBodyHtml(html);
      return body.trim().length > 0;
    },
    prompt: visualCoherencePrompt,
    toEvalResult: (parsed, _transcript, _scenario, _snapshot) =>
      buildDirectionalResult('visual-coherence', toChecklistOutcomes(parsed, VISUAL_COHERENCE_DIMENSIONS)),
  });

  const contentSubstanceInner = new LLMJudgeEvaluator<JudgeChecklist>(gocode, {
    name: 'content-substance',
    evalVersion: '2.0',
    comparisonMode: 'passRate',
    schema: JudgeChecklistSchema,
    canEvaluate: (_transcript, _scenario, snapshot) => Boolean(snapshot?.htmlPath || snapshot?.html),
    validateEvidence: async (_transcript, _scenario, snapshot) => {
      const html = await readSnapshotHtml(snapshot);
      const body = extractBodyHtmlFull(html);
      return body.trim().length > 0;
    },
    prompt: contentSubstancePrompt,
    toEvalResult: (parsed, _transcript, _scenario, _snapshot) =>
      buildDirectionalResult('content-substance', toChecklistOutcomes(parsed, CONTENT_SUBSTANCE_DIMENSIONS)),
  });

  const sharedContentSubstance = new MemoizedLLMJudgeEvaluator(contentSubstanceInner);

  return {
    visualCoherence: new MemoizedLLMJudgeEvaluator(visualCoherenceInner),
    contentSubstanceInv: new ContentSubstanceInvEvaluator(sharedContentSubstance),
    contentSubstanceDir: new ContentSubstanceDirEvaluator(sharedContentSubstance),
  };
}
