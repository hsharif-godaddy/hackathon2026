import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { defaultCriteria } from './default-criteria.js';
import { loadEvidence } from './evidence.js';
import { loadEvaluatorSpec } from './load-evaluator.js';
import { GocaasClient, type ChatMessage, type ContentPart } from './gocaas.js';
import { loadJudgeEnv } from './env.js';
import { shouldAttachScreenshots } from './screenshot-policy.js';
import { writeJudgingMetrics } from './aggregate.js';
import {
  resolveScale,
  normalize,
  extractNumericScore,
  extractCategoricalLabel,
  withinScale,
  type ScoreScale,
} from './scale.js';
import { exists, isObject, readArg, splitCsv, writeJson } from '../utils.js';

function nowIso(): string {
  return new Date().toISOString();
}

function log(message: string, data?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(`${nowIso()} [judge] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`);
}

function readIntArg(name: string): number | null {
  const v = readArg(name);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: "${v}"`);
  return n;
}

function readNestedString(obj: unknown, keys: string[]): string | null {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!isObject(cur)) return null;
    // Prevent prototype pollution
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return null;
    }
    cur = cur[k];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : null;
}


function criteriaFor(params: {
  evaluatorId: string;
  scenarioRow: Record<string, unknown> | null;
  siteType: string | null;
  scoreConfig?: { min?: number; max?: number };
}): Record<string, unknown> {
  const fromScenario = params.scenarioRow?.['evaluators'];
  if (Array.isArray(fromScenario)) {
    const match = fromScenario.find((row) => {
      if (!isObject(row)) return false;
      return row['evaluatorId'] === params.evaluatorId;
    });
    if (isObject(match) && isObject(match['criteria'])) return match['criteria'] as Record<string, unknown>;
  }
  return (
    defaultCriteria({
      evaluatorId: params.evaluatorId,
      siteType: params.siteType,
      scoreConfig: params.scoreConfig,
    }) ?? {}
  );
}

function buildJudgePreamble(params: {
  evaluatorId: string;
  judgeId: string;
  judgeModel: string;
  staticContext?: string;
}): string {
  // No personas. Every judge follows the SAME instructions — the evaluator's own rubric. Panel
  // diversity comes from using distinct model families, so cross-judge disagreement reflects
  // rubric ambiguity rather than an injected stance/model confound.
  //
  // Known systematic biases (e.g., Gemini scores +12 to +18 points higher, median +15) are
  // corrected POST-HOC in aggregation, not via prompt engineering. This preserves measurement
  // integrity: raw scores remain uncontaminated for ICC/variance analysis, and bias corrections
  // are transparent and auditable in the output.
  return [
    `You are an impartial judge running a GoArena LLM-as-Judge evaluator.`,
    `Follow the evaluator's rubric and output schema below EXACTLY. Do not add your own scoring philosophy.`,
    ``,
    `Evaluator: ${params.evaluatorId}`,
    `Model: ${params.judgeModel}`,
    ``,
    `## Evidence rules (strict)`,
    `- Use ONLY the evidence provided in the prompt (conversation, tool invocations, DOM-derived pageContent, and screenshots if attached).`,
    `- Do NOT assume other pages/routes exist unless explicitly shown in evidence.`,
    `- Do NOT penalize unverifiable functionality unless the rubric explicitly says so.`,
    `- If an artifact is missing (e.g. screenshots for a vision evaluator), follow the evaluator's own instructions for that case.`,
    ``,
    params.staticContext ? `## Evaluator static context\n${params.staticContext}` : '',
    `## Output rule (hard)`,
    `Return ONLY valid JSON matching the evaluator's required response format. No extra prose.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMetaPrompt(params: {
  evaluatorId: string;
  staticContext?: string;
  evaluatorTemplate: string;
  contextJson: string;
  judgeRuns: Array<{
    judgeId: string;
    model: string;
    ok: boolean;
    score: number | null;
    rawText: string;
    parsed: unknown;
  }>;
}): string {
  const judgeIds = params.judgeRuns.map((j) => j.judgeId);
  return [
    `You are an ADVISORY meta-judge auditing rubric adherence for an LLM-as-Judge evaluator.`,
    `Your verdicts are advisory only — they do NOT remove judges from the final aggregate (that is`,
    `decided by objective gates). Your job is to flag rubric/evidence violations and recommend a score.`,
    ``,
    `Evaluator: ${params.evaluatorId}`,
    params.staticContext ? `Static context:\n${params.staticContext}` : '',
    ``,
    `## Evidence context (JSON)`,
    params.contextJson,
    ``,
    `## Evaluator template (rubric + required JSON format)`,
    `This is the evaluator YAML template (Handlebars placeholders are NOT rendered here). Judges must follow its rubric and output schema.`,
    `---`,
    params.evaluatorTemplate,
    `---`,
    ``,
    `## Judge outputs`,
    ...params.judgeRuns.flatMap((j) => [
      `### Judge ${j.judgeId} (${j.model})`,
      `ok=${j.ok} score=${j.score === null ? 'null' : String(j.score)}`,
      `raw:`,
      '```',
      j.rawText,
      '```',
    ]),
    ``,
    `## Your task`,
    `For each judge, decide whether they followed the rubric and respected evidence boundaries.`,
    `Mark a judge invalid if they:`,
    `- use evidence not present`,
    `- penalize forbidden things (e.g. unverifiable function)`,
    `- ignore explicit rubric constraints`,
    `- output malformed JSON / wrong fields / wrong score range`,
    ``,
    `Then recommend a final score.`,
    ``,
    `Use these exact judgeId values: ${judgeIds.join(', ')}.`,
    `Return ONLY JSON in this schema:`,
    '```json',
    `{
  "judges": [
    { "judgeId": "<one of the ids above>", "verdict": "valid|invalid", "issues": ["..."] }
  ],
  "recommendedScore": 0,
  "notes": "short explanation",
  "confidence": 0.0
}`,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractConfidence(parsed: unknown): number | null {
  if (!isObject(parsed)) return null;
  const v = parsed['confidence'];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0 || v > 1) return null;
  return v;
}

function stats(values: number[]): {
  n: number;
  mean: number | null;
  variance: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
} {
  if (!values.length) {
    return { n: 0, mean: null, variance: null, stddev: null, min: null, max: null, range: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // Use Bessel's correction (N-1) for sample variance
  // At N=2, population variance underestimates by 50%; at N=3, by 33%
  const variance = values.length > 1
    ? values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1)
    : 0;
  return {
    n: values.length,
    mean,
    variance,
    stddev: Math.sqrt(variance),
    min,
    max,
    range: max - min,
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in response');
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

async function loadImageDataUrl(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  const b64 = buf.toString('base64');
  return `data:image/png;base64,${b64}`;
}

async function buildMessages(params: {
  system: string;
  userText: string;
  screenshotPaths: string[];
}): Promise<ChatMessage[]> {
  if (!params.screenshotPaths.length) {
    return [
      { role: 'system', content: params.system },
      { role: 'user', content: params.userText },
    ];
  }

  const parts: ContentPart[] = [{ type: 'text', text: params.userText }];
  for (const p of params.screenshotPaths) {
    parts.push({ type: 'image_url', image_url: { url: await loadImageDataUrl(p) } });
  }
  return [
    { role: 'system', content: params.system },
    { role: 'user', content: parts },
  ];
}

async function runEvaluator(params: {
  simDir: string;
  evaluatorPath: string;
  resume: boolean;
}): Promise<void> {
  const verbose = process.argv.includes('--verbose');
  const judgeEnv = loadJudgeEnv();
  const client = new GocaasClient(judgeEnv.gocaas);
  const spec = await loadEvaluatorSpec(params.evaluatorPath);
  if (spec.type !== 'llm') return;

  const evidence = await loadEvidence(params.simDir);

  const scale: ScoreScale = resolveScale(spec.scoreConfig);
  const isCategorical = (spec.scoreType ?? 'NUMERIC').toUpperCase() === 'CATEGORICAL';

  const criteria = criteriaFor({
    evaluatorId: spec.evaluatorId,
    scenarioRow: evidence.scenarioRow,
    siteType: readNestedString(evidence.scenarioRow, ['browserConfig', 'qualityEval', 'siteType']),
    scoreConfig: spec.scoreConfig,
  });

  const context = {
    previewUrl: evidence.previewUrl,
    pageContent: evidence.pageContent ?? {},
    conversation: evidence.conversation,
    criteria,
    screenshots: evidence.screenshots,
    toolInvocations: evidence.toolInvocations,
  };
  const contextJson = JSON.stringify(context, null, 2);

  const outDir = path.join(params.simDir, 'judging', spec.evaluatorId);
  const consensusPath = path.join(outDir, 'consensus.json');
  if (params.resume && await exists(consensusPath)) {
    log('evaluator.skip.resume', { simulationId: evidence.simulationId, evaluatorId: spec.evaluatorId });
    return;
  }

  await mkdir(outDir, { recursive: true });
  log('evaluator.start', {
    simulationId: evidence.simulationId,
    evaluatorId: spec.evaluatorId,
    screenshots: shouldAttachScreenshots(spec.evaluatorId) ? evidence.screenshots.length : 0,
  });

  const toolSummary = evidence.toolInvocations.length
    ? [
        `## Tool invocations (evidence)`,
        ...evidence.toolInvocations.slice(0, 80).map((t) =>
          `- ${t.name} input=${JSON.stringify(t.input).slice(0, 500)} output=${JSON.stringify(t.output).slice(0, 500)}`,
        ),
        evidence.toolInvocations.length > 80 ? `- ... (${evidence.toolInvocations.length - 80} more)` : '',
        ``,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const userText = [
    `## Evidence pack`,
    `simulationId=${evidence.simulationId}`,
    `previewUrl=${evidence.previewUrl}`,
    `screenshotsSelected=${evidence.screenshots.map((s) => s.label).join(', ') || 'none'}`,
    ``,
    `## Evidence context (JSON)`,
    contextJson,
    ``,
    toolSummary,
    `## Evaluator template (rubric + required JSON format)`,
    `Handlebars placeholders are NOT rendered here. Use the JSON evidence context above to interpret placeholders like {{pageContent.h1}}.`,
    `---`,
    spec.template,
    `---`,
  ]
    .filter(Boolean)
    .join('\n');

  const screenshotPaths = shouldAttachScreenshots(spec.evaluatorId)
    ? evidence.screenshots.map((s) => s.path)
    : [];

  const judgeRuns: Array<{
    judgeId: string;
    model: string;
    ok: boolean;
    score: number | null;
    label: string | null;
    valid: boolean;
    validityReason: string | null;
    confidence: number | null;
    rawText: string;
    parsed: unknown;
  }> = [];

  // Judges are labelled by model. Disambiguate the rare case of a duplicate model id in the panel.
  const modelCounts = new Map<string, number>();
  for (const [i, model] of judgeEnv.judges.models.entries()) {
    const seen = modelCounts.get(model) ?? 0;
    modelCounts.set(model, seen + 1);
    const judgeId = seen === 0 ? model : `${model}#${seen + 1}`;
    const system = buildJudgePreamble({
      evaluatorId: spec.evaluatorId,
      judgeId,
      judgeModel: model,
      staticContext: spec.staticContext,
    });

    const messages = await buildMessages({ system, userText, screenshotPaths });
    if (verbose) log('judge.call.start', { simulationId: evidence.simulationId, evaluatorId: spec.evaluatorId, judgeId, model, idx: i });

    // Gemini 2.5 Pro uses internal reasoning tokens that count toward maxTokens.
    // Ensure gemini models get enough tokens to complete their response.
    const baseMaxTokens = spec.llmConfig?.maxTokens ?? 2500;
    const effectiveMaxTokens = model.includes('gemini')
      ? Math.max(baseMaxTokens, 5000)  // Gemini needs at least 5000 for reasoning + output + calibration prompt
      : baseMaxTokens;

    const response = await client.chat({
      model,
      messages,
      temperature: spec.llmConfig?.temperature ?? 0,
      maxTokens: effectiveMaxTokens,
    });
    if (verbose) log('judge.call.done', { simulationId: evidence.simulationId, evaluatorId: spec.evaluatorId, judgeId, model });

    let parsed: unknown = null;
    let score: number | null = null;
    let label: string | null = null;
    let confidence: number | null = null;
    let ok = true;
    // Objective validity gate (NOT decided by the meta-judge): JSON must parse and the score
    // must be present and within the evaluator's declared scale (or a label for categorical).
    let valid = false;
    let validityReason: string | null = null;
    try {
      parsed = parseJsonLoose(response.content);
      confidence = extractConfidence(parsed);
      if (isCategorical) {
        label = extractCategoricalLabel(parsed);
        if (label === null) validityReason = 'missing categorical label';
        else valid = true;
      } else {
        score = extractNumericScore(parsed);
        if (score === null) validityReason = 'missing numeric score';
        else if (!withinScale(score, scale)) validityReason = `score ${score} outside scale [${scale.min},${scale.max}]`;
        else valid = true;
      }
    } catch (err) {
      ok = false;
      validityReason = 'unparseable JSON';
      parsed = { error: err instanceof Error ? err.message : String(err) };
      log('judge.parse.error', {
        simulationId: evidence.simulationId,
        evaluatorId: spec.evaluatorId,
        judgeId,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    judgeRuns.push({ judgeId, model, ok, score, label, valid, validityReason, confidence, rawText: response.content, parsed });
    const fileSafeId = judgeId.replace(/[^A-Za-z0-9._#-]/g, '_');
    await writeJson(path.join(outDir, `judge-${fileSafeId}.raw.json`), response.raw);
    await writeJson(path.join(outDir, `judge-${fileSafeId}.json`), {
      judgeId,
      model,
      ok,
      score,
      label,
      valid,
      validityReason,
      confidence,
      parsed,
      rawText: response.content,
    });
  }

  const metaPrompt = buildMetaPrompt({
    evaluatorId: spec.evaluatorId,
    staticContext: spec.staticContext,
    evaluatorTemplate: spec.template,
    contextJson,
    judgeRuns,
  });
  if (verbose) log('meta.call.start', { simulationId: evidence.simulationId, evaluatorId: spec.evaluatorId, model: judgeEnv.judges.metaModel });
  const metaResp = await client.chat({
    model: judgeEnv.judges.metaModel,
    messages: [
      { role: 'system', content: 'You are a strict meta-judge. Return JSON only.' },
      { role: 'user', content: metaPrompt },
    ],
    temperature: 0,
    maxTokens: 2500,
  });
  if (verbose) log('meta.call.done', { simulationId: evidence.simulationId, evaluatorId: spec.evaluatorId, model: judgeEnv.judges.metaModel });

  // Guard meta-judge parsing: if it fails, we still have the judge consensus and should not throw.
  // The meta-judge is advisory only; losing its output is acceptable given all paid judge calls have run.
  let metaParsed: unknown = null;
  try {
    metaParsed = parseJsonLoose(metaResp.content);
  } catch (err) {
    log('meta.parse.failed', {
      simulationId: evidence.simulationId,
      evaluatorId: spec.evaluatorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await writeJson(path.join(outDir, 'meta.raw.json'), metaResp.raw);
  await writeJson(path.join(outDir, 'meta.json'), metaParsed);

  // ── Objective validity (decided by gates above, not by the meta-judge) ──────────────────────
  const validJudges = judgeRuns.filter((j) => j.valid);
  const validityDrops = judgeRuns
    .filter((j) => !j.valid)
    .map((j) => ({ judgeId: j.judgeId, reason: j.validityReason }));

  // ── Post-hoc bias correction ────────────────────────────────────────────────────────────────
  // Empirical bias corrections derived from initial cross-evaluator runs. Applied transparently
  // in aggregation rather than via prompt injection, preserving raw scores for ICC/variance.
  //
  // Derivation: Gemini 2.5 Pro median bias = +15 points vs. GPT-5.2 baseline across initial
  // calibration dataset (range: +12 to +18). Run `pnpm run measure-bias` to update with full data.
  const JUDGE_BIAS_CORRECTIONS: Record<string, number> = {
    'gemini-2.5-pro': -15,  // Derived from calibration runs: median +15pt vs. gpt-5.2
  };

  function applyBiasCorrection(judgeId: string, rawScore: number | null): number | null {
    if (rawScore === null) return null;
    const correction = JUDGE_BIAS_CORRECTIONS[judgeId] ?? 0;
    const corrected = rawScore + correction;
    // Clamp to scale bounds
    return Math.max(scale.min, Math.min(scale.max, corrected));
  }

  // ── Final score: robust aggregate of valid judges (median for n≥3, mean for n=2) ────────────
  const validScoresRaw = validJudges
    .map((j) => j.score)
    .filter((s): s is number => typeof s === 'number');
  const validScoresCorrected = validJudges
    .map((j) => applyBiasCorrection(j.judgeId, j.score))
    .filter((s): s is number => typeof s === 'number');
  const finalNumeric =
    validScoresCorrected.length >= 3
      ? median(validScoresCorrected)
      : validScoresCorrected.length
        ? validScoresCorrected.reduce((a, b) => a + b, 0) / validScoresCorrected.length
        : null;

  // Categorical: final label is the mode across valid judges.
  const validLabels = validJudges.map((j) => j.label).filter((l): l is string => typeof l === 'string');
  const labelCounts = new Map<string, number>();
  for (const l of validLabels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);

  // Sort by count descending, then lexicographically for deterministic tie-breaking
  const finalLabel = validLabels.length
    ? [...labelCounts.entries()].sort((a, b) => {
        const countDiff = b[1] - a[1];
        return countDiff !== 0 ? countDiff : a[0].localeCompare(b[0]);
      })[0]![0]
    : null;

  const finalScore = isCategorical ? null : finalNumeric;

  // ── Agreement (scale-relative, on normalized [0,1] scores) ──────────────────────────────────
  // Compute on CORRECTED scores (post bias-correction) for agreement/ICC to reflect final panel.
  const rawStats = stats(validScoresRaw);
  const correctedStats = stats(validScoresCorrected);
  const normScoresCorrected = validScoresCorrected.map((s) => normalize(s, scale));
  const normStats = stats(normScoresCorrected);
  const AGREEMENT_WITHIN_FRACTION = 0.1; // within 10% of the scale's range

  // Categorical agreement requires N>=3 for meaningful assessment (N=2 is coin flip on binary labels)
  const MIN_CATEGORICAL_JUDGES = 3;
  const agreementComputable = isCategorical
    ? validLabels.length >= MIN_CATEGORICAL_JUDGES
    : validScoresCorrected.length >= 2;

  const labelAgreementFraction = validLabels.length
    ? (labelCounts.get(finalLabel ?? '') ?? 0) / validLabels.length
    : null;
  const exact = isCategorical
    ? labelAgreementFraction === 1 && validLabels.length >= MIN_CATEGORICAL_JUDGES
    : normStats.range === 0 && correctedStats.n >= 2;
  const withinThreshold = isCategorical
    ? (labelAgreementFraction ?? 0) >= 0.5 && validLabels.length >= MIN_CATEGORICAL_JUDGES
    : typeof normStats.range === 'number' && normStats.range <= AGREEMENT_WITHIN_FRACTION && correctedStats.n >= 2;

  // ── Meta-judge: advisory recommendation; override = it meaningfully differs from finalScore ──
  const recommended =
    isObject(metaParsed) && typeof metaParsed['recommendedScore'] === 'number'
      ? (metaParsed['recommendedScore'] as number)
      : null;
  const overrideEpsilon = (scale.max - scale.min) * 0.05; // 5% of scale range
  const metaOverride =
    !isCategorical &&
    typeof recommended === 'number' &&
    typeof finalScore === 'number' &&
    Math.abs(recommended - finalScore) > overrideEpsilon;

  const validConfidences = validJudges
    .map((j) => j.confidence)
    .filter((c): c is number => typeof c === 'number');
  const confidenceStats = stats(validConfidences);
  const metaConfidence =
    isObject(metaParsed) && typeof metaParsed['confidence'] === 'number'
      ? (metaParsed['confidence'] as number)
      : null;

  // ── Calibration ground truth: the production GoArena score for this evaluator ────────────────
  // Production rows are keyed by slug (airo-…) or by evaluator UUID with the human name in
  // scoreName, so resolve by evaluatorId first and fall back to the evaluator's scoreName.
  const prodByEvaluatorId = evidence.productionScores[spec.evaluatorId];
  const prodByScoreName = spec.scoreName ? evidence.productionScores[spec.scoreName] : undefined;
  const productionScore =
    typeof prodByEvaluatorId === 'number'
      ? prodByEvaluatorId
      : typeof prodByScoreName === 'number'
        ? prodByScoreName
        : null;
  const delta =
    typeof finalScore === 'number' && productionScore !== null ? finalScore - productionScore : null;

  await writeJson(consensusPath, {
    evaluatorId: spec.evaluatorId,
    evaluatorPath: params.evaluatorPath,
    simulationId: evidence.simulationId,
    previewUrl: evidence.previewUrl,
    scoreType: isCategorical ? 'CATEGORICAL' : 'NUMERIC',
    scale,
    biasCorrections: Object.fromEntries(
      Object.entries(JUDGE_BIAS_CORRECTIONS).filter(([judgeId]) =>
        judgeRuns.some((j) => j.judgeId === judgeId)
      )
    ),
    judges: judgeRuns.map((j) => {
      const biasCorrection = JUDGE_BIAS_CORRECTIONS[j.judgeId] ?? 0;
      const correctedScore = applyBiasCorrection(j.judgeId, j.score);
      return {
        judgeId: j.judgeId,
        model: j.model,
        ok: j.ok,
        valid: j.valid,
        validityReason: j.validityReason,
        rawScore: j.score,  // Original model output
        score: correctedScore,  // Bias-corrected score used in aggregation
        ...(biasCorrection !== 0 && { biasCorrection }),  // Only include if non-zero
        label: j.label,
        confidence: j.confidence,
      };
    }),
    metaModel: judgeEnv.judges.metaModel,
    validJudgeIds: validJudges.map((j) => j.judgeId),
    recommendedScore: recommended,
    finalScore,
    finalLabel,
    metrics: {
      judgeAgreement: {
        basis: 'valid_judges_bias_corrected',
        n: isCategorical ? validLabels.length : correctedStats.n,
        computable: agreementComputable,
        exact,
        withinFraction: AGREEMENT_WITHIN_FRACTION,
        withinThreshold,
        labelAgreementFraction,
        ...(isCategorical &&
          !agreementComputable && {
            insufficientDataNote: `N=${validLabels.length} judges insufficient for categorical agreement (min ${MIN_CATEGORICAL_JUDGES}). With 2 judges on binary labels, P(agreement by chance) = 0.50, making the metric indistinguishable from random.`,
          }),
      },
      scoreVariance: {
        raw: rawStats,  // Before bias correction
        corrected: correctedStats,  // After bias correction (used for finalScore)
        normalized: normStats,  // Corrected scores normalized to [0,1]
      },
      confidence: {
        basis: 'valid_judges',
        judges: confidenceStats,
        meta: metaConfidence,
      },
      metaJudgeOverride: {
        recommendedScore: recommended,
        finalScore,
        epsilon: overrideEpsilon,
        override: metaOverride,
      },
      validity: {
        nTotal: judgeRuns.length,
        nValid: validJudges.length,
        drops: validityDrops,
      },
      vsProduction: {
        productionScore,
        delta,
        absDelta: delta === null ? null : Math.abs(delta),
      },
    },
    generatedAt: new Date().toISOString(),
  });
  log('evaluator.done', {
    simulationId: evidence.simulationId,
    evaluatorId: spec.evaluatorId,
    finalScore,
    nValid: validJudges.length,
    productionScore,
    delta,
    metaOverride,
  });
}

async function listSimulationDirs(datasetDir: string): Promise<string[]> {
  const entries = await readdir(datasetDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(datasetDir, e.name))
    .sort();
}

function defaultEvaluatorPaths(): string[] {
  const base = path.resolve(process.cwd(), '../goarena/evaluators');
  return [
    'ambiguity_handling_quality.yaml',
    'business-fit.yaml',
    'content_specificity.yaml',
    'content-quality.yaml',
    'conversation_to_artifact_consistency.yaml',
    'conversion_path_clarity.yaml',
    'flow_efficiency.yaml',
    'hero-section-presence.yaml',
    'implicit_feature_gap.yaml',
    'intent_resolution_status.yaml',
    'intent_to_output_alignment.yaml',
    'navigation-presence.yaml',
    'primary-cta-presence.yaml',
    'scope_drift_overgeneration.yaml',
    'silent_hallucination.yaml',
    'structural_coherence.yaml',
    'task_completion_status.yaml',
    'trust_signal_coverage.yaml',
    'usability.yaml',
    'visual_layout_sanity.yaml',
    'visual-quality.yaml',
  ].map((f) => path.join(base, f));
}

async function main(): Promise<void> {
  const datasetDir = readArg('--dataset-dir') ?? path.resolve('dataset');
  const resume = process.argv.includes('--resume');
  const workers = readIntArg('--workers') ?? 1;
  const sims = splitCsv(readArg('--simulation-id'));

  const evaluatorPaths = splitCsv(readArg('--evaluators'));
  const evaluators = evaluatorPaths.length
    ? evaluatorPaths.map((p) => path.resolve(process.cwd(), p))
    : defaultEvaluatorPaths();

  const startedAt = Date.now();
  const simDirs = sims.length ? sims.map((id) => path.join(datasetDir, id)) : await listSimulationDirs(datasetDir);
  const tasks = simDirs.flatMap((simDir) => evaluators.map((evaluatorPath) => ({ simDir, evaluatorPath })));
  log('run.start', {
    datasetDir,
    simulations: simDirs.length,
    evaluators: evaluators.length,
    tasks: tasks.length,
    workers,
    resume,
  });

  if (workers <= 1) {
    for (const simDir of simDirs) {
      log('simulation.start', { simDir: path.basename(simDir) });
      for (const evaluatorPath of evaluators) {
        await runEvaluator({ simDir, evaluatorPath, resume });
      }
      log('simulation.done', { simDir: path.basename(simDir) });
    }
  } else {
    let next = 0;
    const failures: Array<{ idx: number; error: string }> = [];
    const worker = async function worker(workerId: number): Promise<void> {
      for (;;) {
        const idx = next;
        next += 1;
        if (idx >= tasks.length) return;
        const task = tasks[idx];
        if (!task) return;
        if (idx % Math.max(1, Math.floor(tasks.length / 10)) === 0) {
          log('progress', { done: idx, total: tasks.length, workerId });
        }
        try {
          await runEvaluator({ simDir: task.simDir, evaluatorPath: task.evaluatorPath, resume });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const simulationId = path.basename(task.simDir);
          const evaluatorId = path.basename(task.evaluatorPath, '.yaml');
          log('worker.task.error', { workerId, idx, simulationId, evaluatorId, error: errorMsg });
          failures.push({ idx, error: errorMsg });
          continue;
        }
      }
    };

    const pools = Array.from({ length: workers }, (_v, i) => worker(i + 1));
    await Promise.all(pools);

    if (failures.length > 0) {
      log('run.failures', { count: failures.length, total: tasks.length, failures });
    }
  }

  // Metrics are part of judging: after producing/refreshing consensus.json files,
  // aggregate them across the dataset.
  await writeJudgingMetrics({ datasetDir });
  log('metrics.done', { path: path.join(datasetDir, 'judging-metrics.json') });
  log('run.done', { elapsedMs: Date.now() - startedAt });
}

await main();

